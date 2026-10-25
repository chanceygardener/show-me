--- `:checkhealth show_me`: can agents reach this Neovim, and is the CLI installed?

local M = {}

function M.check()
  local registry = require 'show_me.registry'
  vim.health.start 'show-me'

  if vim.fn.has 'nvim-0.10' == 1 then
    vim.health.ok 'Neovim 0.10 or later'
  else
    vim.health.error 'show-me needs Neovim 0.10 or later'
  end

  if vim.v.servername ~= '' then
    vim.health.ok('RPC server: ' .. vim.v.servername)
  else
    vim.health.error('no RPC server, so agents cannot reach this Neovim', { 'Do not start Neovim with --listen ""' })
  end

  local file = registry.file()
  if vim.uv.fs_stat(file) then
    vim.health.ok('registered: ' .. file)
  else
    vim.health.warn('not registered', { "Call require('show_me').setup()" })
  end

  local exe = vim.fn.exepath 'show-me'
  if exe == '' then
    local installed = vim.fs.joinpath(registry.base_dir(), 'bin', vim.fn.has 'win32' == 1 and 'show-me.exe' or 'show-me')
    exe = vim.uv.fs_stat(installed) and installed or ''
  end
  if exe == '' then
    vim.health.warn('show-me CLI not found', { 'Run install.sh (install.ps1 on Windows) from the plugin directory' })
  else
    local result = vim.system({ exe, 'version' }, { text = true }):wait()
    vim.health.ok(('%s (%s)'):format(vim.trim(result.stdout or ''), exe))
  end
end

return M
