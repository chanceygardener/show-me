local T = require 'test.nvim.helpers'
local store = require 'show_me.store'

---Run `fn` and return its rejection reason, or nil if it succeeded.
---@return string|nil
local function rejection(fn, ...)
  local ok, err = pcall(fn, ...)
  if ok then
    return nil
  end
  return store.is_rejection(err) and tostring(err) or ('NOT A REJECTION: ' .. tostring(err))
end

---@type ShowMeView
local view = { layout = 'single', panes = { { path = '/x/a.lua', first = 1, last = 2 } } }

local root = T.tmpdir()
local s = store.open(root)
local d = s:create 'First'
T.eq(d.id, 1, 'first deck is 1')
T.eq(type(d.created_at), 'number', 'created_at is a number')
T.ok(d.created_at > 1700000000000, 'created_at is epoch milliseconds')
T.eq(d.done, false, 'new deck is not done')

T.eq(s:add_view(1, view), 1, 'first view is 1')
T.eq(s:add_view('1', view), 2, 'string ids accepted')
T.eq(rejection(s.add_view, s, 99, view), 'unknown deck 99', 'unknown deck')
T.eq(rejection(s.finish, s, s:create('Empty').id), 'deck 2 has no views', 'empty deck cannot finish')

T.nil_(s:latest_done(), 'no done decks yet')
s:finish(1)
T.eq(s:latest_done().id, 1, 'finished deck is latest done')
T.eq(rejection(s.add_view, s, 1, view), 'deck 1 is already done; start a new one', 'done deck is closed')

local full = s:create 'Full'
for _ = 1, store.MAX_VIEWS do
  s:add_view(full.id, view)
end
T.eq(rejection(s.add_view, s, full.id, view), ('deck %d already has 9 views, the most an editor can open by number'):format(full.id), 'view cap')

local loaded = store.open(root):get(1)
T.eq(loaded.title, 'First', 'title persisted')
T.eq(loaded.views[1].panes[1].first, 1, 'pane range persisted')
T.eq(loaded.done, true, 'done flag persisted')

vim.fn.writefile({ '{not json' }, root .. '/50.json')
T.ok(pcall(s.list_done, s), 'a corrupt deck file does not break listing')
T.eq(rejection(s.get, s, 50), 'unknown deck 50', 'a corrupt deck reads as unknown')

for i = 1, 12 do
  s:create('Bulk ' .. i)
end
local ids = s:ids()
T.eq(#ids, store.KEEP, 'only KEEP decks kept')
T.eq(s:create('Next').id, ids[#ids] + 1, 'ids keep increasing after pruning')

local a = s:create 'A'
s:add_view(a.id, view)
s:finish(a.id)
T.eq(s:list_done()[1].id, a.id, 'list_done is newest first')

local one, two = store.for_workspace(root, '/w/one'), store.for_workspace(root, '/w/two')
T.ok(one.root ~= two.root, 'each workspace has its own directory')
T.eq(one:create('x').id, 1, 'ids are per workspace')

T.done()
