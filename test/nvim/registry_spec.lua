local T = require 'test.nvim.helpers'
local config = require 'show_me.config'
local registry = require 'show_me.registry'
local state = require 'show_me.state'

config.apply { state_dir = T.tmpdir() }
if vim.v.servername == '' then
  vim.fn.serverstart()
end

local home = vim.env.SHOW_ME_HOME
T.eq(registry.base_dir(), home, 'SHOW_ME_HOME overrides the base dir')
vim.env.SHOW_ME_HOME = ''
if vim.fn.has 'win32' == 1 then
  T.eq(registry.base_dir(), vim.fs.joinpath(vim.env.LOCALAPPDATA, 'show-me'), 'Windows base dir')
else
  vim.env.XDG_STATE_HOME = '/xdg'
  T.eq(registry.base_dir(), '/xdg/show-me', 'XDG_STATE_HOME base dir')
  vim.env.XDG_STATE_HOME = ''
  T.eq(registry.base_dir(), vim.fs.joinpath(vim.uv.os_homedir(), '.local', 'state', 'show-me'), 'default base dir')
end
vim.env.SHOW_ME_HOME = home

---@return table
local function read(file)
  return vim.json.decode(table.concat(vim.fn.readfile(file), '\n'))
end

local workspace = T.tmpdir()
state.set_workspace(workspace)
local file = assert(registry.write())
T.eq(file, vim.fs.joinpath(home, 'editors', ('nvim-%d.json'):format(vim.fn.getpid())), 'entry file named by pid')
local entry = read(file)
T.eq(entry.protocol, 1, 'protocol')
T.eq(entry.editor, 'nvim', 'editor')
T.eq(entry.pid, vim.fn.getpid(), 'pid')
T.eq(entry.transport.kind, 'nvim', 'transport kind')
T.eq(entry.transport.address, vim.v.servername, 'transport is the built-in server')
T.eq(entry.workspace_folders[1], vim.uv.fs_realpath(workspace), 'workspace is symlink-resolved')
T.eq(entry.open_hint, '<leader>v1', 'open hint')
T.ok(entry.started_at > 1700000000000, 'started_at is epoch milliseconds')
T.eq(entry.focused_at, entry.started_at, 'focused_at starts at started_at')
if vim.fn.has 'win32' == 0 then
  T.eq(vim.uv.fs_stat(file).mode % 512, tonumber('600', 8), 'entry is private')
  T.eq(vim.uv.fs_stat(vim.fs.dirname(file)).mode % 512, tonumber('700', 8), 'editors dir is private')
end

vim.wait(5)
registry.touch()
local touched = read(file)
T.ok(touched.focused_at > entry.focused_at, 'touch moves focused_at')
T.eq(touched.started_at, entry.started_at, 'touch keeps started_at')

local before_failure = table.concat(vim.fn.readfile(file), '\n')
local real_fs_write = vim.uv.fs_write
vim.uv.fs_write = function()
  return nil, 'ENOSPC: simulated'
end
local failed_file, reason = registry.write()
vim.uv.fs_write = real_fs_write
T.nil_(failed_file, 'a failed write returns no file')
T.ok(reason and reason:find('ENOSPC', 1, true), 'a failed write says why')
T.nil_(vim.uv.fs_stat(file .. '.tmp'), 'a failed write leaves no temp file')
T.eq(table.concat(vim.fn.readfile(file), '\n'), before_failure, 'a failed write leaves the entry unchanged')

---Run `registry.write()` with one `vim.uv` function failing.
---@param name string
---@return string|nil file
---@return string|nil reason
local function write_with_failing(name)
  local real = vim.uv[name]
  vim.uv[name] = function()
    return nil, 'EACCES: simulated ' .. name
  end
  local ok, written, why = pcall(registry.write)
  vim.uv[name] = real
  T.ok(ok, ('a failed %s does not raise (%s)'):format(name, tostring(written)))
  return written, why
end

for _, name in ipairs { 'fs_open', 'fs_rename' } do
  local written, why = write_with_failing(name)
  T.nil_(written, ('a failed %s returns no file'):format(name))
  T.ok(why and why:find(name, 1, true), ('a failed %s says why'):format(name))
  T.nil_(vim.uv.fs_stat(file .. '.tmp'), ('a failed %s leaves no temp file'):format(name))
  T.eq(table.concat(vim.fn.readfile(file), '\n'), before_failure, ('a failed %s leaves the entry unchanged'):format(name))
end
T.eq(select('#', registry.touch()), 0, 'touch returns nothing, as an autocmd callback must')

registry.remove()
T.nil_(vim.uv.fs_stat(file), 'remove deletes the entry')

T.done()
