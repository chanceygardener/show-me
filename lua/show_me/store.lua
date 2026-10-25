--- show-me decks on disk: one JSON file per deck, one directory per workspace.
---
--- The CLI has already checked layouts, panes and ranges. This module enforces
--- only what needs deck state (the deck exists, isn't done, has room for
--- another view) and keeps the newest `KEEP` decks. It never touches windows.

local util = require 'show_me.util'

local M = {}

--- Views are opened by number, 1-9, so a deck holds at most 9.
M.MAX_VIEWS = 9

--- Decks kept per workspace; older ones are deleted on each `create`.
M.KEEP = 10

---@class ShowMePane
---@field path string Absolute path
---@field first? integer 1-based first highlighted line
---@field last? integer 1-based last highlighted line, inclusive

---@class ShowMeView
---@field layout 'single'|'cols2'|'cols3'|'main-stack'
---@field title? string
---@field panes ShowMePane[]

---@class ShowMeDeck
---@field id integer Monotonic per workspace
---@field title string
---@field created_at integer Epoch milliseconds
---@field done boolean Only done decks are announced and can become current
---@field views ShowMeView[]

--- A request that deck state rules out. `rpc.handle` turns it into the reply's
--- `error`, which the CLI prints for the agent verbatim.
---@class ShowMeRejection
---@field reason string
local Rejection = {}
Rejection.__index = Rejection
Rejection.__tostring = function(self)
  return self.reason
end

---@param fmt string
---@param ... any
function M.reject(fmt, ...)
  error(setmetatable({ reason = fmt:format(...) }, Rejection), 0)
end

---@param err any
---@return boolean
function M.is_rejection(err)
  return getmetatable(err) == Rejection
end

---@class ShowMeStore
---@field root string
local Store = {}
Store.__index = Store

---@param root string
---@return ShowMeStore
function M.open(root)
  vim.fn.mkdir(root, 'p')
  return setmetatable({ root = root }, Store)
end

---The store for `folder`, keyed by the first 16 hex characters of its sha256.
---@param state_dir string
---@param folder string
---@return ShowMeStore
function M.for_workspace(state_dir, folder)
  return M.open(vim.fs.joinpath(state_dir, vim.fn.sha256(folder):sub(1, 16)))
end

---@param id integer
---@return string
function Store:file(id)
  return vim.fs.joinpath(self.root, ('%d.json'):format(id))
end

---@return integer[] ids Ascending
function Store:ids()
  local ids = {}
  for name in vim.fs.dir(self.root) do
    local id = name:match '^(%d+)%.json$'
    if id then
      ids[#ids + 1] = tonumber(id)
    end
  end
  table.sort(ids)
  return ids
end

---@param id integer
---@return ShowMeDeck|nil deck nil when the file is missing or corrupt
function Store:load(id)
  local read, lines = pcall(vim.fn.readfile, self:file(id))
  if not read or #lines == 0 then
    return nil
  end
  local decoded, deck = pcall(vim.json.decode, table.concat(lines, '\n'))
  return decoded and type(deck) == 'table' and deck or nil
end

---Write atomically, so a concurrent reader never sees half a deck.
---@param d ShowMeDeck
function Store:save(d)
  local file = self:file(d.id)
  vim.fn.writefile({ vim.json.encode(d) }, file .. '.tmp')
  assert(vim.uv.fs_rename(file .. '.tmp', file))
end

---@param id string|integer
---@return ShowMeDeck
function Store:get(id)
  local d = tonumber(id) and self:load(tonumber(id))
  if not d then
    M.reject('unknown deck %s', tostring(id))
  end
  return d
end

---Start a new deck and prune the oldest beyond `M.KEEP`.
---@param title string Already checked by the CLI
---@return ShowMeDeck
function Store:create(title)
  local ids = self:ids()
  ---@type ShowMeDeck
  local d = { id = (ids[#ids] or 0) + 1, title = title, created_at = util.now_ms(), done = false, views = {} }
  self:save(d)
  for i = 1, #ids + 1 - M.KEEP do
    os.remove(self:file(ids[i]))
  end
  return d
end

---@param id string|integer
---@param view ShowMeView Already checked by the CLI
---@return integer n The view's number within the deck
function Store:add_view(id, view)
  local d = self:get(id)
  if d.done then
    M.reject('deck %d is already done; start a new one', d.id)
  elseif #d.views >= M.MAX_VIEWS then
    M.reject('deck %d already has %d views, the most an editor can open by number', d.id, M.MAX_VIEWS)
  end
  table.insert(d.views, view)
  self:save(d)
  return #d.views
end

---@param id string|integer
---@return ShowMeDeck
function Store:finish(id)
  local d = self:get(id)
  if #d.views == 0 then
    M.reject('deck %d has no views', d.id)
  end
  d.done = true
  self:save(d)
  return d
end

---@return ShowMeDeck[] decks Newest first
function Store:list_done()
  local done = {}
  local ids = self:ids()
  for i = #ids, 1, -1 do
    local d = self:load(ids[i])
    if d and d.done then
      done[#done + 1] = d
    end
  end
  return done
end

---@return ShowMeDeck|nil
function Store:latest_done()
  return self:list_done()[1]
end

return M
