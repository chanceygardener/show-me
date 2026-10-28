--- Minimal assertions for specs run with `nvim --clean -l`.
---
--- Requiring this puts the repository on 'runtimepath' (so `require 'show_me'`
--- finds lua/show_me) and points SHOW_ME_HOME at a throwaway directory, so no
--- spec ever touches the real registry.

vim.opt.rtp:prepend(vim.fn.getcwd())
vim.env.SHOW_ME_HOME = vim.fn.tempname()

local M = {}

local failures = 0
local total = 0

---@param label string
---@param passed boolean
---@param detail? string
local function record(label, passed, detail)
  total = total + 1
  if passed then
    io.write('  ok   ', label, '\n')
  else
    failures = failures + 1
    io.write('  FAIL ', label, detail and ('  -> ' .. detail) or '', '\n')
  end
end

---@param actual any
---@param expected any
---@param label string
function M.eq(actual, expected, label)
  record(label, actual == expected, ('expected %s, got %s'):format(vim.inspect(expected), vim.inspect(actual)))
end

---@param value any
---@param label string
function M.ok(value, label)
  record(label, value and true or false, ('expected truthy, got %s'):format(vim.inspect(value)))
end

---@param value any
---@param label string
function M.nil_(value, label)
  record(label, value == nil, ('expected nil, got %s'):format(vim.inspect(value)))
end

---A fresh, empty directory.
---@return string
function M.tmpdir()
  local dir = vim.fn.tempname()
  vim.fn.mkdir(dir, 'p')
  return dir
end

--- Print the summary and exit with a status the shell can act on.
function M.done()
  io.write(('  %d/%d passed\n'):format(total - failures, total))
  os.exit(failures == 0 and 0 or 1)
end

return M
