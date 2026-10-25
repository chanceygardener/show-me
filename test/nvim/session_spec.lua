local T = require 'test.nvim.helpers'
local render = require 'show_me.render'
local show_me = require 'show_me'

show_me.setup { state_dir = T.tmpdir() }

local file = vim.fn.tempname() .. '.lua'
vim.fn.writefile({ 'one', 'two' }, file)
render.open({ id = 1, title = 'S', created_at = 0, done = true, views = { { layout = 'single', panes = { { path = file } } } } }, 1)
T.ok(render.tab(), 'the show-me tab is open')

-- The show-me tab is transient and t:show_me isn't saved, so a restored copy
-- would be an orphan. Neovim has no SessionWritePre, so the handler closes the
-- tab after the write and rewrites the file. Any session plugin built on
-- :mksession fires this.
local session = vim.fn.tempname() .. '.vim'
vim.cmd('mksession! ' .. vim.fn.fnameescape(session))
T.nil_(render.tab(), 'writing a session closes the show-me tab')
local has_tabnew = vim.iter(vim.fn.readfile(session)):any(function(line)
  return line:match '^tabnew' ~= nil
end)
T.ok(not has_tabnew, 'the session file is rewritten without the show-me tab')

T.done()
