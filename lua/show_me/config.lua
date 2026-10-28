--- show-me options: their types, their defaults, and the merged result.
---
--- `setup(opts)` calls `apply`; every other module reads `options`.

local M = {}

---@class ShowMeKeys
---@field view_prefix string Followed by 1-9 to open that view
---@field next string
---@field prev string
---@field pick string
---@field close string

---@class ShowMeSidebarConfig
---@field filetypes string[] Windows with these filetypes are sidebars, kept beside views
---@field open table<string, fun()> How to open each sidebar in the show-me tab

---@class ShowMeConfig
---@field keys ShowMeKeys|false false: no mappings, only the `<Plug>` ones
---@field sidebar ShowMeSidebarConfig
---@field picker 'auto'|'snacks'|'select' auto: snacks if loaded, else vim.ui.select
---@field state_dir string Where decks are stored, one directory per workspace

---@return ShowMeConfig
function M.defaults()
  return {
    keys = { view_prefix = '<leader>v', next = ']v', prev = '[v', pick = '<leader>vd', close = '<leader>vq' },
    sidebar = {
      filetypes = { 'neo-tree', 'NvimTree' },
      open = {
        ['neo-tree'] = function()
          vim.cmd 'Neotree show'
        end,
        NvimTree = function()
          vim.cmd 'NvimTreeOpen'
        end,
      },
    },
    picker = 'auto',
    state_dir = vim.fs.joinpath(vim.fn.stdpath 'state', 'show-me'),
  }
end

---@type ShowMeConfig
M.options = M.defaults()

---Merge `opts` over the defaults. Lists replace rather than merge, so
---`sidebar.filetypes = { 'oil' }` means only oil.
---@param opts? table
---@return ShowMeConfig
function M.apply(opts)
  opts = opts or {}
  local merged = vim.tbl_deep_extend('force', M.defaults(), opts)
  if opts.sidebar and opts.sidebar.filetypes then
    merged.sidebar.filetypes = opts.sidebar.filetypes
  end
  M.options = merged
  return merged
end

---How the user opens view 1, for notifications and for agents.
---@return string
function M.open_hint()
  local keys = M.options.keys
  return keys and (keys.view_prefix .. '1') or ':ShowMe 1'
end

return M
