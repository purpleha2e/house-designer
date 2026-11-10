import {mergeConfig} from 'vite'
import base from '../../vite.config.ts'

// Diagnostic outputs can be large and briefly locked on Windows. They are not
// source modules and must not trigger reloads or terminate the test server.
export default mergeConfig(base, {server: {hmr: false, watch: {
  ignored: ['**/docs/**', '**/tmp/**'],
}}})
