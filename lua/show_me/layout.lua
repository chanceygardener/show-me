--- The four show-me layouts, and how to build each from the current window.
---
--- The CLI has already checked names and pane counts. Splits name their
--- direction explicitly so 'splitright'/'splitbelow' never change the
--- geometry, and widths are shares of the window the layout starts from, so a
--- fixed-width sidebar beside it keeps its space.

local M = {}

--- Share of the available width the primary pane of `main-stack` takes.
local MAIN_SHARE = 0.6

---@param win integer
---@param direction 'right'|'below'
---@return integer
local function split(win, direction)
  return vim.api.nvim_open_win(0, false, { split = direction, win = win })
end

---@param count integer
---@return integer[]
local function columns(count)
  local wins = { vim.api.nvim_get_current_win() }
  for i = 2, count do
    wins[i] = split(wins[i - 1], 'right')
  end
  vim.cmd 'wincmd ='
  return wins
end

---@param count integer
---@return integer[]
local function main_stack(count)
  local main = vim.api.nvim_get_current_win()
  local available = vim.api.nvim_win_get_width(main)
  local wins = { main, split(main, 'right') }
  for i = 3, count do
    wins[i] = split(wins[i - 1], 'below')
  end
  vim.cmd 'wincmd ='
  vim.api.nvim_win_set_width(main, math.floor(available * MAIN_SHARE))
  return wins
end

---@type table<string, fun(count: integer): integer[]>
local BUILDERS = { single = columns, cols2 = columns, cols3 = columns, ['main-stack'] = main_stack }

---Split the current window into layout `name`.
---@param name string
---@param count integer
---@return integer[] wins Window ids in pane order
function M.build(name, count)
  local builder = assert(BUILDERS[name], 'show-me: unknown layout ' .. tostring(name))
  return builder(count)
end

return M
