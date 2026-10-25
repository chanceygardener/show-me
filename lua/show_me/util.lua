--- Helpers shared by more than one show-me module.

local M = {}

---@return integer ms Milliseconds since the epoch
function M.now_ms()
  local sec, usec = vim.uv.gettimeofday()
  return sec * 1000 + math.floor(usec / 1000)
end

return M
