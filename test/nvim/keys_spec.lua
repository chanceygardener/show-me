local T = require 'test.nvim.helpers'
local config = require 'show_me.config'
local show_me = require 'show_me'

show_me.setup { state_dir = T.tmpdir(), keys = false }
T.eq(vim.fn.maparg('<leader>v1', 'n'), '', 'keys = false defines no mappings')
T.ok(vim.fn.maparg('<Plug>(show-me-view-1)', 'n') ~= '', '<Plug> mappings still exist')
T.eq(config.open_hint(), ':ShowMe 1', 'the hint names the command instead')

T.done()
