local T = require 'test.nvim.helpers'
local config = require 'show_me.config'
local rpc = require 'show_me.rpc'
local state = require 'show_me.state'

config.apply { state_dir = T.tmpdir() }
local workspace = T.tmpdir()
state.set_workspace(workspace)

local notes = {}
vim.notify = function(msg)
  notes[#notes + 1] = msg
end

---@param request table
---@return table reply
local function call(request)
  request.protocol = request.protocol or rpc.PROTOCOL
  return vim.json.decode(rpc.handle(vim.json.encode(request)))
end

local pane = { path = '/x/a.lua', first = 2, last = 3 }

local r = call { command = 'deck', title = 'Login flow' }
T.eq(r.ok, true, 'deck ok')
T.eq(r.result.deck, 1, 'deck id')
r = call { command = 'view', deck = 1, view = { layout = 'cols2', title = 'Both', panes = { pane, pane } } }
T.eq(r.result.view, 1, 'view number')
r = call { command = 'done', deck = 1 }
T.eq(r.result.deck, 1, 'done deck')
T.eq(r.result.views, 1, 'done view count')
T.eq(r.result.open_hint, '<leader>v1', 'done says how to open')
vim.wait(200, function()
  return #notes > 0
end)
T.eq(notes[1], 'show-me: Login flow · 1 view · <leader>v1', 'done notifies, without moving focus')
T.eq(state.current().id, 1, 'the done deck becomes current')

r = call { command = 'status' }
T.eq(r.result.editor, 'nvim', 'status editor')
T.eq(r.result.workspace_folders[1], vim.uv.fs_realpath(workspace), 'status workspace')
T.eq(r.result.current.title, 'Login flow', 'status current deck')

r = call { command = 'view', deck = 1, view = { layout = 'single', panes = { pane } } }
T.eq(r.ok, false, 'view to a done deck fails')
T.eq(r.error, 'deck 1 is already done; start a new one', 'editor-side rejection text')
T.eq(call({ command = 'nope' }).error, 'unknown command "nope"', 'unknown command')
T.eq(call({ command = 'status', protocol = 2 }).error, 'unsupported protocol 2 (this editor speaks 1)', 'protocol mismatch')
T.eq(vim.json.decode(rpc.handle('{oops')).error, 'request is not JSON', 'malformed request')

state.set_workspace(T.tmpdir())
T.eq(call({ command = 'status' }).result.current, vim.NIL, 'no current deck is null')

-- A `:cd` mid-deck must not send the agent's later calls to another workspace.
state.set_workspace(T.tmpdir())
T.eq(call({ command = 'deck', title = 'Workspace A deck' }).result.deck, 1, 'deck 1 in workspace A')
local workspace_b = vim.uv.fs_realpath(T.tmpdir())
local store_b = require('show_me.store').for_workspace(config.options.state_dir, workspace_b)
store_b:create 'Workspace B deck'
state.set_workspace(workspace_b)
local seen = #notes
T.eq(call({ command = 'view', deck = 1, view = { layout = 'single', panes = { pane } } }).ok, true, 'view after :cd ok')
T.eq(call({ command = 'done', deck = 1 }).ok, true, 'done after :cd ok')
vim.wait(200, function()
  return #notes > seen
end)
T.eq(notes[seen + 1], 'show-me: Workspace A deck · 1 view · <leader>v1', 'done after :cd finishes the deck it started')
local deck_b = store_b:get(1)
T.eq(deck_b.done, false, "workspace B's deck 1 is not done")
T.eq(#deck_b.views, 0, "workspace B's deck 1 has no views")

T.done()
