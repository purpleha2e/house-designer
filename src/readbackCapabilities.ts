import { FloatType, HalfFloatType, UnsignedByteType, type WebGLRenderer } from 'three'

const installed = new WeakSet<WebGLRenderer>()

/** Three's async readback still queries IMPLEMENTATION_COLOR_READ_TYPE before
 * testing types it accepts unconditionally. That query drains queued GPU work,
 * including first-use shader translation. Test those known cases first. */
export function installNonBlockingReadbackChecks(renderer: WebGLRenderer) {
  if (installed.has(renderer)) return
  installed.add(renderer)
  const configure = () => {
    const readable = renderer.capabilities.textureTypeReadable.bind(renderer.capabilities)
    const halfFloat = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float')
    renderer.capabilities.textureTypeReadable = type => type === UnsignedByteType || type === FloatType ||
      (type === HalfFloatType && halfFloat) || readable(type)
  }
  configure()
  // Three replaces capabilities on context restoration. Its constructor's
  // restoration listener runs before this one, so patch the replacement too.
  renderer.domElement.addEventListener('webglcontextrestored', configure)
}
