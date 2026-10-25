--- What this Neovim's show-me session knows: the workspace it serves, that
--- workspace's deck store, and the deck the view keys act on.

local config = require 'show_me.config'
local store = require 'show_me.store'

local M = {}

---@class ShowMeState
---@field workspace string|nil Symlink-resolved folder this Neovim serves
---@field store ShowMeStore|nil
---@field current ShowMeDeck|nil

---@type ShowMeState
local state = {}

--- The store each unfinished deck was created in, so a `:cd` mid-deck doesn't
--- send the agent's later `view` and `done` to another workspace.
---@type table<integer, ShowMeStore>
local unfinished = {}

---Serve `dir` (default: the global cwd). Forgets the old store and current deck.
---@param dir? string
---@return string workspace
function M.set_workspace(dir)
  dir = dir or vim.fn.getcwd(-1, -1)
  state = { workspace = vim.uv.fs_realpath(dir) or dir }
  return state.workspace
end

---@return string
function M.workspace()
  return state.workspace or M.set_workspace()
end

---@return ShowMeStore
function M.store()
  if not state.store then
    state.store = store.for_workspace(config.options.state_dir, M.workspace())
  end
  return state.store
end

---Remember that deck `id` was created in `deck_store`.
---@param id integer
---@param deck_store ShowMeStore
function M.remember(id, deck_store)
  unfinished[id] = deck_store
end

---Forget where deck `id` was created, once it is done.
---@param id integer
function M.forget(id)
  unfinished[id] = nil
end

---The store deck `id` was created in, else the current workspace's.
---@param id integer
---@return ShowMeStore
function M.store_for(id)
  return unfinished[id] or M.store()
end

---The deck the view keys act on: the last one picked or finished, else the
---newest done deck on disk.
---@return ShowMeDeck|nil
function M.current()
  state.current = state.current or M.store():latest_done()
  return state.current
end

---@param deck ShowMeDeck
function M.set_current(deck)
  state.current = deck
end

return M
