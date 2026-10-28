local T = require 'test.nvim.helpers'
local config = require 'show_me.config'

T.eq(config.open_hint(), '<leader>v1', 'default hint')
config.apply { keys = false }
T.eq(config.options.keys, false, 'keys = false survives merging')
T.eq(config.open_hint(), ':ShowMe 1', 'hint without keys')
config.apply { keys = { view_prefix = '<leader>s' } }
T.eq(config.open_hint(), '<leader>s1', 'custom prefix')
T.eq(config.options.keys.next, ']v', 'unset keys keep their defaults')
config.apply { sidebar = { filetypes = { 'oil' } } }
T.eq(table.concat(config.options.sidebar.filetypes, ','), 'oil', 'filetypes replace the default list')
T.ok(config.options.sidebar.open['neo-tree'], 'sidebar openers keep their defaults')
T.ok(config.defaults().state_dir:find('show-me', 1, true), 'decks live under stdpath state')

T.done()
