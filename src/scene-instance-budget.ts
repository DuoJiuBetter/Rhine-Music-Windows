import {
  DynamicDrawUsage,
  Frustum,
  InstancedBufferAttribute,
  Matrix4,
  Sphere,
  Vector3,
  type PerspectiveCamera,
} from "three";

/** Logical slots never move. Compact rendering lists independently of the pool,
 * atlas ownership and picking IDs. Sphere tests include the whole tilted card. */
export class SceneInstanceBudget {
  readonly pool: Float32Array;
  readonly visibleMatrices: InstancedBufferAttribute;
  readonly shadowMatrices: InstancedBufferAttribute;
  readonly visibleSlots: number[] = [];
  readonly prioritySlots: number[] = [];
  // Keep diagnostic names comparable with Perf5: every visible slot is physical.
  readonly nearSlots = this.visibleSlots;
  readonly farSlots: number[] = [];
  readonly shadowSlots: number[] = [];
  private readonly depths: Float32Array;
  private readonly projection = new Matrix4();
  private readonly frustum = new Frustum();
  private readonly matrix = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly center = new Vector3(0, 1.85, 0);
  private readonly viewCenter = new Vector3();
  enabled = false;
  readonly capacity: number;
  private readonly radius: number;
  constructor(capacity: number, radius = 2.9) {
    this.capacity = capacity;
    this.radius = radius;
    this.pool = new Float32Array(capacity * 16);
    const matrices = () =>
      new InstancedBufferAttribute(
        new Float32Array(capacity * 16),
        16,
      ).setUsage(DynamicDrawUsage);
    this.visibleMatrices = matrices();
    this.shadowMatrices = matrices();
    this.depths = new Float32Array(capacity);
  }
  update(
    camera: PerspectiveCamera,
    shadow: Frustum,
    focus: number,
    _aperture: number,
    _maxBlur: number,
    _width: number,
    _dt: number,
    _motion: boolean,
  ) {
    this.projection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projection);
    for (const slots of [
      this.visibleSlots,
      this.farSlots,
      this.shadowSlots,
      this.prioritySlots,
    ])
      slots.length = 0;
    for (let slot = 0; slot < this.capacity; slot++) {
      this.matrix.fromArray(this.pool, slot * 16);
      const scale = this.matrix.getMaxScaleOnAxis();
      if (scale < 0.00001) continue;
      this.sphere.center.copy(this.center).applyMatrix4(this.matrix);
      // Padding covers blur at the viewport edge and near-plane intersections.
      this.sphere.radius = this.radius * scale + 0.35;
      if (shadow.intersectsSphere(this.sphere)) this.shadowSlots.push(slot);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      this.visibleSlots.push(slot);
      const view = this.viewCenter
        .copy(this.sphere.center)
        .applyMatrix4(camera.matrixWorldInverse);
      this.depths[slot] = -view.z;
    }
    // No focal-distance or count limit: all conservatively visible cards retain
    // their original physical glass. Offscreen shadows remain independent.
    this.prioritySlots.push(...this.visibleSlots);
    this.prioritySlots.sort(
      (a, b) =>
        Math.abs(this.depths[a] - focus) - Math.abs(this.depths[b] - focus),
    );
    this.compact(this.visibleMatrices, this.visibleSlots);
    this.compact(this.shadowMatrices, this.shadowSlots);
  }
  private compact(
    attribute: InstancedBufferAttribute,
    slots: number[],
  ) {
    const output = attribute.array as Float32Array;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      output.set(this.pool.subarray(slot * 16, slot * 16 + 16), i * 16);
    }
    attribute.clearUpdateRanges();
    if (slots.length) {
      attribute.addUpdateRange(0, slots.length * 16);
      attribute.needsUpdate = true;
    }
  }
  reset() {
    this.visibleSlots.length = this.prioritySlots.length = this.shadowSlots.length = 0;
  }
  snapshot() {
    return {
      enabled: this.enabled,
      pool: this.capacity,
      visible: this.visibleSlots.length,
      culled: this.capacity - this.visibleSlots.length,
      nearGlass: this.nearSlots.length,
      farGlass: this.farSlots.length,
      shadowCasters: this.shadowSlots.length,
      nearLimit: null,
      materialPolicy: "all-visible-physical",
      overlappingGlass: this.nearSlots.length + this.farSlots.length - this.visibleSlots.length,
    };
  }
}
