import * as THREE from "three";

/** Retain only detached models with released cover references. Active return
 * animations stay independent; reuse starts after ordinary retirement. */
export class ReturningModelPool {
  private idle: THREE.Group[] = [];
  private epoch = 0;
  private created = 0;
  private reused = 0;
  readonly limit: number;
  constructor(limit = 8) { this.limit = limit; }
  acquire(template: THREE.Group, prepare: (group: THREE.Group) => void) {
    let group = this.idle.pop();
    if (!group) {
      group = template.clone(true); prepare(group); this.created++;
      group.userData.returningPoolEpoch = this.epoch;
    } else {
      this.reused++;
      group.position.copy(template.position); group.quaternion.copy(template.quaternion);
      group.scale.copy(template.scale); group.visible = template.visible;
      group.layers.mask = template.layers.mask; group.renderOrder = template.renderOrder;
      // Geometry/layout belongs to the same template epoch. Preserve owned
      // materials/programs, restoring the template's transforms and visibility.
      group.children.forEach((child, i) => {
        const source = template.children[i];
        child.position.copy(source.position); child.quaternion.copy(source.quaternion); child.scale.copy(source.scale);
        child.visible = source.visible; child.layers.mask = source.layers.mask;
        child.castShadow = source.castShadow; child.receiveShadow = source.receiveShadow;
        child.renderOrder = source.renderOrder; child.frustumCulled = source.frustumCulled;
      });
      group.updateMatrix(); group.matrixWorldNeedsUpdate = true;
    }
    return group;
  }
  release(group: THREE.Group, releaseCovers: (group: THREE.Group) => void, dispose: (group: THREE.Group) => void) {
    group.removeFromParent(); releaseCovers(group);
    if (group.userData.returningPoolEpoch === this.epoch && this.idle.length < this.limit) this.idle.push(group);
    else dispose(group);
  }
  invalidate(dispose: (group: THREE.Group) => void) {
    this.epoch++; for (const group of this.idle) dispose(group); this.idle.length = 0;
  }
  stats() { return {idle: this.idle.length, limit: this.limit, created: this.created, reused: this.reused}; }
}
