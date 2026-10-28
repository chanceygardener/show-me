local T = require 'test.nvim.helpers'
local registry = require 'show_me.registry'
local show_me = require 'show_me'

if vim.v.servername == '' then
  vim.fn.serverstart()
end
show_me.setup { state_dir = T.tmpdir() }
if vim.v.vim_did_enter == 0 then
  vim.api.nvim_exec_autocmds('VimEnter', { group = 'show_me' })
end

---@return table
local function entry()
  return vim.json.decode(table.concat(vim.fn.readfile(registry.file()), '\n'))
end

T.ok(vim.uv.fs_stat(registry.file()), 'setup registers this Neovim')
T.ok(vim.fn.maparg('<leader>v1', 'n') ~= '', 'default keys map <leader>v1')
T.ok(vim.fn.maparg('<leader>v9', 'n') ~= '', 'default keys map <leader>v9')
T.ok(vim.fn.maparg(']v', 'n') ~= '', 'default keys map ]v')
T.ok(vim.fn.maparg('<leader>vq', 'n') ~= '', 'default keys map <leader>vq')
T.ok(vim.fn.maparg('<Plug>(show-me-view-9)', 'n') ~= '', '<Plug> mappings exist')
T.eq(vim.fn.exists ':ShowMe', 2, ':ShowMe exists')

local dir = T.tmpdir()
vim.cmd.cd(dir)
T.eq(entry().workspace_folders[1], vim.uv.fs_realpath(dir), ':cd updates the registered workspace')

local before = entry().focused_at
vim.wait(5)
vim.api.nvim_exec_autocmds('FocusGained', { group = 'show_me' })
T.ok(entry().focused_at > before, 'FocusGained updates focused_at')
vim.api.nvim_exec_autocmds('FocusGained', { group = 'show_me' })
T.ok(#vim.api.nvim_get_autocmds { group = 'show_me', event = 'FocusGained' } == 1, 'the FocusGained handler survives being run')

T.ok(show_me.status():find('current: none', 1, true), 'status reports no deck yet')

vim.api.nvim_exec_autocmds('VimLeavePre', { group = 'show_me' })
T.nil_(vim.uv.fs_stat(registry.file()), 'leaving Neovim removes the entry')

T.done()
