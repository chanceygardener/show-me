local T = require 'test.nvim.helpers'
local layout = require 'show_me.layout'

---Build `name` in a fresh tab.
---@return integer[] wins
---@return table tree `winlayout()` of the tab
local function build(name, count)
  vim.cmd 'tabnew'
  local wins = layout.build(name, count)
  return wins, vim.fn.winlayout()
end

local wins, tree = build('single', 1)
T.eq(#wins, 1, 'single: one window')
T.eq(tree[1], 'leaf', 'single: one leaf')

wins, tree = build('cols3', 3)
T.eq(tree[1], 'row', 'cols3: a row')
T.eq(#tree[2], 3, 'cols3: three columns')
for i = 1, 3 do
  T.eq(tree[2][i][2], wins[i], ('cols3: pane %d is column %d'):format(i, i))
end

wins, tree = build('main-stack', 4)
T.eq(tree[1], 'row', 'main-stack: a row')
T.eq(tree[2][1][2], wins[1], 'main-stack: pane 1 is the left column')
T.eq(tree[2][2][1], 'col', 'main-stack: right side is a column')
T.eq(#tree[2][2][2], 3, 'main-stack: three stacked panes')
for i = 2, 4 do
  T.eq(tree[2][2][2][i - 1][2], wins[i], ('main-stack: pane %d is stack row %d'):format(i, i - 1))
end

-- main-stack takes 60% of the window it starts from, not of the whole screen.
vim.cmd 'tabnew'
vim.cmd 'topleft 20vnew'
local side = vim.api.nvim_get_current_win()
vim.wo[side].winfixwidth = true
vim.cmd 'wincmd l'
local available = vim.api.nvim_win_get_width(0)
wins = layout.build('main-stack', 3)
T.eq(vim.api.nvim_win_get_width(side), 20, 'main-stack leaves a fixed-width sidebar alone')
T.eq(vim.api.nvim_win_get_width(wins[1]), math.floor(available * 0.6), 'main pane is 60% of the available width')

-- Geometry must not depend on the user's split options.
vim.o.splitright, vim.o.splitbelow = false, false
wins, tree = build('cols2', 2)
T.eq(tree[2][1][2], wins[1], 'cols2: pane 1 stays left with splitright off')
wins, tree = build('main-stack', 3)
T.eq(tree[2][2][2][1][2], wins[2], 'main-stack: pane 2 stays on top with splitbelow off')

T.done()
