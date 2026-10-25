--- The show-me protocol endpoint. The CLI calls `handle` over Neovim's own RPC
--- server (`nvim_exec_lua`) with one JSON request and gets back one JSON
--- reply, shaped as in protocol/PROTOCOL.md.

local config = require 'show_me.config'
local state = require 'show_me.state'
local store = require 'show_me.store'

local M = {}

--- The protocol version this plugin speaks.
M.PROTOCOL = 1

---@class ShowMeRequest
---@field protocol integer
---@field command 'deck'|'view'|'done'|'status'
---@field title? string
---@field deck? integer
---@field view? ShowMeView

---@param d ShowMeDeck
local function announce(d)
  local count = #d.views
  vim.schedule(function()
    vim.notify(('show-me: %s · %d view%s · %s'):format(d.title, count, count == 1 and '' or 's', config.open_hint()), vim.log.levels.INFO)
  end)
end

---@type table<string, fun(req: ShowMeRequest): table>
local COMMANDS = {
  deck = function(req)
    return { deck = state.store():create(req.title).id }
  end,
  view = function(req)
    return { view = state.store():add_view(req.deck, req.view) }
  end,
  done = function(req)
    local d = state.store():finish(req.deck)
    state.set_current(d)
    announce(d)
    return { deck = d.id, views = #d.views, open_hint = config.open_hint() }
  end,
  status = function()
    local d = state.current()
    return {
      editor = 'nvim',
      workspace_folders = { state.workspace() },
      current = d and { deck = d.id, title = d.title, views = #d.views } or vim.NIL,
    }
  end,
}

---@param reason string
---@return string
local function failure(reason)
  return vim.json.encode { ok = false, error = reason }
end

---Answer one request. Never raises: every failure is an `ok = false` reply.
---@param json string
---@return string
function M.handle(json)
  local decoded, req = pcall(vim.json.decode, json)
  if not decoded or type(req) ~= 'table' then
    return failure 'request is not JSON'
  end
  if req.protocol ~= M.PROTOCOL then
    return failure(('unsupported protocol %s (this editor speaks %d)'):format(tostring(req.protocol), M.PROTOCOL))
  end
  local command = COMMANDS[req.command or '']
  if not command then
    return failure(('unknown command %q'):format(tostring(req.command)))
  end
  local ok, result = pcall(command, req)
  if ok then
    return vim.json.encode { ok = true, result = result }
  elseif store.is_rejection(result) then
    return failure(tostring(result))
  end
  return failure('internal error: ' .. tostring(result))
end

return M
