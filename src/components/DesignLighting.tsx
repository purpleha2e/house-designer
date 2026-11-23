/** Neutral world-space studio illumination shared by all rooms and viewpoints. */
export function DesignLighting() {
  return <>
    <color attach="background" args={['#dae2ec']} />
    <ambientLight color="#ffffff" intensity={1.1} />
    <hemisphereLight color="#f5f8ff" groundColor="#bac0c7" position={[0.25, 1, 0.12]} intensity={0.8} />
    <directionalLight color="#fff8f1" position={[-3, 8, 5]} intensity={1.04} />
  </>
}
