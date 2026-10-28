-- Stand-in for the real plugin: echoes the request so transport tests can
-- check what arrived without depending on deck storage.
local M = {}

function M.handle(json)
  local req = vim.json.decode(json)
  return vim.json.encode { ok = true, result = { echo = req.command, deck = req.deck } }
end

return M
