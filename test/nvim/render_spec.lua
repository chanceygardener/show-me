local T = require 'test.nvim.helpers'
local config = require 'show_me.config'
local render = require 'show_me.render'

local function numbered(n)
  return vim.tbl_map(tostring, vim.fn.range(1, n))
end

local a = vim.fn.tempname() .. '.lua'
local b = vim.fn.tempname() .. '.lua'
vim.fn.writefile(numbered(100), a)
vim.fn.writefile(numbered(10), b) -- the deck below claims lines 15-40: the file "shrank"

---@type ShowMeDeck
local d = {
  id = 1,
  title = 'Demo 100%',
  created_at = 0,
  done = true,
  views = {
    { layout = 'cols2', title = 'Same file', panes = { { path = a, first = 10, last = 12 }, { path = a, first = 50, last = 55 } } },
    { layout = 'single', panes = { { path = b, first = 15, last = 40 } } },
  },
}

local home = vim.api.nvim_get_current_tabpage()
render.open(d, 1)
local tab = render.tab()
T.ok(tab and tab ~= home, 'views open in their own tab')

local wins = vim.api.nvim_tabpage_list_wins(tab)
T.eq(#wins, 2, 'cols2 has two panes')
local buf = vim.api.nvim_win_get_buf(wins[1])
T.eq(vim.api.nvim_win_get_buf(wins[2]), buf, 'both panes show the same buffer')
T.eq(#vim.api.nvim_buf_get_extmarks(buf, render.NS, 0, -1, {}), 2, 'both ranges in a shared buffer stay highlighted')
T.eq(vim.api.nvim_win_get_cursor(wins[1])[1], 10, 'pane 1 cursor at its range')
T.eq(vim.api.nvim_win_get_cursor(wins[2])[1], 50, 'pane 2 cursor at its range')
T.ok(vim.wo[wins[1]].winbar:find('1/2', 1, true), 'winbar shows position')
T.ok(vim.wo[wins[1]].winbar:find('Same file', 1, true), 'winbar shows view title')
T.eq(vim.api.nvim_get_current_win(), wins[1], 'focus lands on pane 1')

render.step(1)
T.eq(render.position().view, 2, ']v moves to view 2')
wins = vim.api.nvim_tabpage_list_wins(render.tab())
T.eq(#wins, 1, 'single has one pane')
T.eq(vim.api.nvim_win_get_cursor(wins[1])[1], 10, 'range past EOF clamps to the last line')
T.ok(vim.wo[wins[1]].winbar:find('Demo 100%%', 1, true), 'falls back to deck title, with % escaped')

render.step(1)
T.eq(render.position().view, 2, ']v at the last view stays put')

vim.api.nvim_set_current_tabpage(home)
render.step(-1)
T.eq(render.position().view, 2, '[v does nothing outside the show-me tab')

render.open(d, 1)
local count = 0
for _, t in ipairs(vim.api.nvim_list_tabpages()) do
  count = count + (vim.t[t].show_me and 1 or 0)
end
T.eq(count, 1, 'reopening reuses the single show-me tab')

render.close()
T.nil_(render.tab(), 'close removes the show-me tab')
T.nil_(render.position(), 'close forgets the position')
T.eq(#vim.api.nvim_buf_get_extmarks(buf, render.NS, 0, -1, {}), 0, 'close clears highlights')

-- Sidebars ---------------------------------------------------------------

-- At 80 columns beside a 30-column sidebar each of three panes is 16 wide, below
-- the default 'winwidth' of 20, which would widen whichever pane has focus.
vim.o.winwidth = 1

local mirror_side = 'topleft'

---Open a 30-column fake sidebar on `side` of the current tab.
---@param side 'topleft'|'botright'
---@return integer win
local function open_tree(side)
  vim.cmd(side .. ' 30vnew')
  vim.bo.buftype = 'nofile'
  vim.bo.bufhidden = 'wipe'
  vim.bo.filetype = 'fake-tree'
  return vim.api.nvim_get_current_win()
end

config.apply {
  sidebar = {
    filetypes = { 'fake-tree' },
    open = {
      ['fake-tree'] = function()
        open_tree(mirror_side)
      end,
    },
  },
}

---@param t integer
---@return integer[] sidebars
---@return integer[] panes
local function split_wins(t)
  local sidebars, panes = {}, {}
  for _, w in ipairs(vim.api.nvim_tabpage_list_wins(t)) do
    local list = vim.bo[vim.api.nvim_win_get_buf(w)].filetype == 'fake-tree' and sidebars or panes
    list[#list + 1] = w
  end
  return sidebars, panes
end

---@param t integer
local function close_panes(t)
  for _, w in ipairs(select(2, split_wins(t))) do
    vim.api.nvim_win_close(w, true)
  end
end

---@type ShowMeDeck
local three = {
  id = 2,
  title = 'Three',
  created_at = 0,
  done = true,
  views = {
    { layout = 'cols3', panes = { { path = a }, { path = a }, { path = b } } },
    { layout = 'single', panes = { { path = b } } },
  },
}

vim.api.nvim_set_current_tabpage(home)
open_tree 'topleft'
vim.cmd 'wincmd l'
render.open(three, 1)
local sidebars, panes = split_wins(render.tab())
T.eq(#sidebars, 1, 'a sidebar in the user tab is mirrored into the show-me tab')
T.eq(#panes, 3, 'cols3 still has three panes beside the sidebar')
T.eq(vim.api.nvim_win_get_width(sidebars[1]), 30, 'the sidebar keeps its width')
local widths = vim.tbl_map(vim.api.nvim_win_get_width, panes)
T.ok(math.max(unpack(widths)) - math.min(unpack(widths)) <= 1, 'cols3 splits the remaining width evenly')
T.ok(not vim.tbl_contains(sidebars, vim.api.nvim_get_current_win()), 'focus lands on a pane, not the sidebar')

render.step(1)
sidebars, panes = split_wins(render.tab())
T.eq(#sidebars, 1, 'the sidebar survives switching views')
T.eq(#panes, 1, 'single has one pane beside the sidebar')

close_panes(render.tab())
render.step(-1)
sidebars, panes = split_wins(render.tab())
T.eq(#panes, 3, 'a tab left with only a sidebar gets its panes back')
T.eq(vim.api.nvim_win_get_position(sidebars[1])[2], 0, 'a left sidebar stays on the left')

-- A right-hand sidebar: rebuilt panes open to its left.
render.close()
vim.api.nvim_set_current_tabpage(home)
for _, w in ipairs((split_wins(home))) do
  vim.api.nvim_win_close(w, true)
end
mirror_side = 'botright'
open_tree 'botright'
vim.cmd 'wincmd h'
render.open(three, 2)
close_panes(render.tab())
render.step(-1)
sidebars, panes = split_wins(render.tab())
local side_col = vim.api.nvim_win_get_position(sidebars[1])[2]
T.ok(
  vim.iter(panes):all(function(w)
    return vim.api.nvim_win_get_position(w)[2] < side_col
  end),
  'panes open left of a right-hand sidebar'
)

-- No sidebar in the user tab means none in the show-me tab.
render.close()
vim.api.nvim_set_current_tabpage(home)
for _, w in ipairs((split_wins(home))) do
  vim.api.nvim_win_close(w, true)
end
render.open(three, 1)
sidebars = split_wins(render.tab())
T.eq(#sidebars, 0, 'no sidebar in the user tab means none in the show-me tab')

T.done()
