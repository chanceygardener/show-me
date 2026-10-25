--- This Neovim's entry in the show-me registry, which is how the CLI finds it.
---
--- One JSON file per running editor under `<base>/editors/`, private to the
--- user. The entry points at Neovim's own RPC server (`v:servername`), so
--- show-me starts no server of its own.

local config = require 'show_me.config'
local rpc = require 'show_me.rpc'
local state = require 'show_me.state'
local util = require 'show_me.util'

local M = {}

---@class ShowMeTransport
---@field kind 'nvim'
---@field address string

---@class ShowMeEntry
---@field protocol integer
---@field editor 'nvim'
---@field pid integer
---@field workspace_folders string[]
---@field transport ShowMeTransport
---@field open_hint string
---@field started_at integer Epoch milliseconds
---@field focused_at integer Epoch milliseconds

---@type integer|nil
local started_at
---@type integer|nil
local focused_at

---show-me's home, shared with the CLI. Empty variables count as unset.
---@return string
function M.base_dir()
  local override = vim.env.SHOW_ME_HOME
  if override and override ~= '' then
    return override
  end
  if vim.fn.has 'win32' == 1 then
    return vim.fs.joinpath(vim.env.LOCALAPPDATA, 'show-me')
  end
  local state_home = vim.env.XDG_STATE_HOME
  if not state_home or state_home == '' then
    state_home = vim.fs.joinpath(vim.uv.os_homedir(), '.local', 'state')
  end
  return vim.fs.joinpath(state_home, 'show-me')
end

---@return string
function M.file()
  return vim.fs.joinpath(M.base_dir(), 'editors', ('nvim-%d.json'):format(vim.fn.getpid()))
end

---@return ShowMeEntry
function M.entry()
  return {
    protocol = rpc.PROTOCOL,
    editor = 'nvim',
    pid = vim.fn.getpid(),
    workspace_folders = { state.workspace() },
    transport = { kind = 'nvim', address = vim.v.servername },
    open_hint = config.open_hint(),
    started_at = started_at,
    focused_at = focused_at,
  }
end

---@param dir string
local function private_dir(dir)
  vim.fn.mkdir(dir, 'p')
  if vim.fn.has 'win32' == 0 then
    vim.uv.fs_chmod(dir, tonumber('700', 8))
  end
end

---Write (or rewrite) the entry atomically.
---@return string|nil file
---@return string|nil reason Why there is no entry
function M.write()
  if vim.v.servername == '' then
    return nil, 'Neovim has no RPC server (was it started with --listen "")?'
  end
  started_at = started_at or util.now_ms()
  focused_at = focused_at or started_at
  local file = M.file()
  private_dir(M.base_dir())
  private_dir(vim.fs.dirname(file))
  local tmp = file .. '.tmp'
  local fd = assert(vim.uv.fs_open(tmp, 'w', tonumber('600', 8)))
  local data = vim.json.encode(M.entry())
  local wrote, write_err = vim.uv.fs_write(fd, data)
  local _, close_err = vim.uv.fs_close(fd)
  local err = write_err or close_err or (wrote ~= #data and 'short write to ' .. tmp) or nil
  if err then
    os.remove(tmp)
    return nil, err
  end
  assert(vim.uv.fs_rename(tmp, file))
  return file
end

---Record that the user is looking at this Neovim, so it wins ties.
function M.touch()
  focused_at = util.now_ms()
  M.write()
end

function M.remove()
  os.remove(M.file())
end

return M
