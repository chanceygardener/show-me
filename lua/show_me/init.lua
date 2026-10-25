--- show-me: lets terminal coding agents illustrate explanations in this Neovim.
---
--- An agent runs the `show-me` CLI, which finds this Neovim through its
--- registry entry (`registry.lua`) and calls `rpc.handle` over Neovim's own
--- RPC server. Agents build a *deck* of numbered *views*; the user opens them
--- at their own pace. Nothing here ever moves focus on its own.

local config = require 'show_me.config'
local registry = require 'show_me.registry'
local render = require 'show_me.render'
local state = require 'show_me.state'

local M = {}

---Open view `n` of the current deck.
---@param n integer
function M.open(n)
  local d = state.current()
  if not d then
    vim.notify('show-me: no deck yet; ask an agent to show you something', vim.log.levels.WARN)
  elseif not d.views[n] then
    vim.notify(('show-me: "%s" has %d view%s'):format(d.title, #d.views, #d.views == 1 and '' or 's'), vim.log.levels.WARN)
  else
    render.open(d, n)
  end
end

---@param delta integer
function M.step(delta)
  render.step(delta)
end

function M.close()
  render.close()
end

---@param decks ShowMeDeck[]
---@param choose fun(deck: ShowMeDeck|nil)
local function snacks_pick(decks, choose)
  local items = vim.tbl_map(function(d)
    local lines = {}
    for i, v in ipairs(d.views) do
      lines[#lines + 1] = ('%d. %s  [%s]'):format(i, v.title or '', v.layout)
      for _, p in ipairs(v.panes) do
        lines[#lines + 1] = '     ' .. vim.fn.fnamemodify(p.path, ':~:.') .. (p.first and (':%d-%d'):format(p.first, p.last) or '')
      end
    end
    return { text = d.title, deck = d, preview = { text = table.concat(lines, '\n') } }
  end, decks)
  _G.Snacks.picker {
    title = 'Show-me decks',
    items = items,
    preview = 'preview',
    format = function(item)
      return {
        { ('%3d  '):format(item.deck.id), 'SnacksPickerComment' },
        { item.deck.title, 'SnacksPickerLabel' },
        { ('  %d views'):format(#item.deck.views), 'SnacksPickerComment' },
      }
    end,
    confirm = function(picker, item)
      picker:close()
      choose(item and item.deck)
    end,
  }
end

---Pick a recent deck; it becomes current and opens at view 1.
function M.pick()
  local decks = state.store():list_done()
  if #decks == 0 then
    vim.notify('show-me: no decks yet', vim.log.levels.WARN)
    return
  end
  local function choose(d)
    if d then
      state.set_current(d)
      render.open(d, 1)
    end
  end
  local picker = config.options.picker
  local snacks = rawget(_G, 'Snacks')
  if picker == 'snacks' or (picker == 'auto' and snacks and snacks.picker) then
    snacks_pick(decks, choose)
  else
    vim.ui.select(decks, {
      prompt = 'Show-me decks',
      format_item = function(d)
        return ('%d  %s  (%d views)'):format(d.id, d.title, #d.views)
      end,
    }, choose)
  end
end

---@return string
function M.status()
  local d = state.current()
  return table.concat({
    'workspace: ' .. state.workspace(),
    'server: ' .. (vim.v.servername ~= '' and vim.v.servername or 'none'),
    'registry: ' .. registry.file(),
    'current: ' .. (d and ('deck %d "%s" (%d views)'):format(d.id, d.title, #d.views) or 'none'),
  }, '\n')
end

local function start()
  state.set_workspace()
  local file, reason = registry.write()
  if not file then
    vim.notify('show-me: agents cannot reach this Neovim: ' .. reason, vim.log.levels.WARN)
  end
end

local function define_plugs()
  for n = 1, 9 do
    vim.keymap.set('n', ('<Plug>(show-me-view-%d)'):format(n), function()
      M.open(n)
    end, { desc = ('show-me: open view %d'):format(n) })
  end
  vim.keymap.set('n', '<Plug>(show-me-next)', function()
    M.step(1)
  end, { desc = 'show-me: next view' })
  vim.keymap.set('n', '<Plug>(show-me-prev)', function()
    M.step(-1)
  end, { desc = 'show-me: previous view' })
  vim.keymap.set('n', '<Plug>(show-me-pick)', M.pick, { desc = 'show-me: pick a deck' })
  vim.keymap.set('n', '<Plug>(show-me-close)', M.close, { desc = 'show-me: close the view tab' })
end

---@param keys ShowMeKeys
local function map_keys(keys)
  for n = 1, 9 do
    vim.keymap.set('n', keys.view_prefix .. n, ('<Plug>(show-me-view-%d)'):format(n), { desc = ('show-me: [v]iew %d'):format(n) })
  end
  vim.keymap.set('n', keys.next, '<Plug>(show-me-next)', { desc = 'show-me: next view' })
  vim.keymap.set('n', keys.prev, '<Plug>(show-me-prev)', { desc = 'show-me: previous view' })
  vim.keymap.set('n', keys.pick, '<Plug>(show-me-pick)', { desc = 'show-me: pick a [d]eck' })
  vim.keymap.set('n', keys.close, '<Plug>(show-me-close)', { desc = 'show-me: [q]uit the view tab' })
end

---@param opts? table See `ShowMeConfig`
function M.setup(opts)
  config.apply(opts)
  vim.api.nvim_set_hl(0, 'ShowMeRange', { link = 'Visual', default = true })
  define_plugs()
  if config.options.keys then
    map_keys(config.options.keys)
  end

  -- Callbacks are wrapped so they return nil: an autocmd callback that
  -- returns a truthy value is deleted after its first run.
  local group = vim.api.nvim_create_augroup('show_me', { clear = true })
  if vim.v.vim_did_enter == 1 then
    start()
  else
    vim.api.nvim_create_autocmd('VimEnter', { group = group, once = true, callback = start })
  end
  vim.api.nvim_create_autocmd('DirChanged', {
    group = group,
    pattern = 'global',
    callback = function()
      state.set_workspace()
      registry.write()
    end,
  })
  vim.api.nvim_create_autocmd('FocusGained', {
    group = group,
    callback = function()
      registry.touch()
    end,
  })
  vim.api.nvim_create_autocmd('VimLeavePre', {
    group = group,
    callback = function()
      registry.remove()
    end,
  })
  vim.api.nvim_create_autocmd('TabClosed', {
    group = group,
    callback = function()
      render.on_tab_closed()
    end,
  })
  -- Neovim has no SessionWritePre event; Post is the closest built-in hook, so
  -- the tab is closed right after a write (see the task-9 report).
  vim.api.nvim_create_autocmd('SessionWritePost', {
    group = group,
    callback = function()
      render.close()
    end,
  })

  vim.api.nvim_create_user_command('ShowMe', function(o)
    local n = tonumber(o.args)
    if o.args == '' then
      M.pick()
    elseif n then
      M.open(n)
    else
      vim.notify('show-me: usage :ShowMe [view number]', vim.log.levels.WARN)
    end
  end, { nargs = '?', desc = 'Open show-me view N of the current deck, or pick a deck' })
end

return M
