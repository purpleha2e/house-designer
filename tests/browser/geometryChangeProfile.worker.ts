import { runPartitionedVisibilityExperiment } from '../partitionedVisibilityExperiment'
import { profileIndirectGeometryChanges } from '../indirectGeometryChangeProfile'
self.onmessage = ({ data }) => {
  try { self.postMessage({ ok: true, ...profileIndirectGeometryChanges(data.before, data.after), partitioned: runPartitionedVisibilityExperiment(data.before, data.after) }) }
  catch (error) { self.postMessage({ ok: false, error: String(error) }) }
}
