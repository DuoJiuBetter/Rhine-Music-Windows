import * as THREE from "three";

/** Retire only a tiny, slow, rotation-aligned tail, below half a physical pixel. */
export class ReturningCardBudget {
  readonly bounds = new THREE.Box3();
  private actual = new THREE.Vector3();
  private resting = new THREE.Vector3();
  private restPosition = new THREE.Vector3();
  private restRotation = new THREE.Euler();
  private restQuaternion = new THREE.Quaternion();
  private restMatrix = new THREE.Matrix4();

  canRetire(group: THREE.Group, lift: number, velocity: number, restTilt: number,
    camera: THREE.Camera, width: number, height: number) {
    if (this.bounds.isEmpty() || !Number.isFinite(lift + velocity + restTilt) ||
      Math.abs(lift) > .01 || Math.abs(velocity) > .05 || group.rotation.y !== 0 ||
      !Number.isFinite(width + height) || width <= 0 || height <= 0) return false;
    group.updateMatrixWorld(true);
    this.restPosition.copy(group.position); this.restPosition.y -= lift;
    this.restRotation.copy(group.rotation); this.restRotation.x = restTilt;
    this.restQuaternion.setFromEuler(this.restRotation);
    this.restMatrix.compose(this.restPosition, this.restQuaternion, group.scale);
    if (group.parent) this.restMatrix.premultiply(group.parent.matrixWorld);
    const { min, max } = this.bounds;
    for (let i = 0; i < 8; i++) {
      this.actual.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
      this.resting.copy(this.actual).applyMatrix4(this.restMatrix).project(camera);
      this.actual.applyMatrix4(group.matrixWorld).project(camera);
      // Near-plane crossings/non-finite projections must use exact retirement.
      if (!Number.isFinite(this.actual.x + this.actual.y + this.resting.x + this.resting.y) ||
        Math.abs(this.actual.z) > 1 || Math.abs(this.resting.z) > 1 ||
        Math.hypot((this.actual.x - this.resting.x) * width / 2,
          (this.actual.y - this.resting.y) * height / 2) > .5) return false;
    }
    return true;
  }
}
