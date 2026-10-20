/** Temporary effects budget from real input cadence, not spring settling time. */
export class RapidSwitchBudget {
  private gain = 0;
  private reducedFrames = 0;
  private restored = 0;
  private shortenedReturns = 0;
  readonly returningLimit = 4;
  update(burst: boolean, eligible: boolean, dt: number) {
    const previous=this.gain;
    if (!eligible)this.gain=0;
    else if (burst) this.gain=1;
    else this.gain=Math.max(0,this.gain-Math.max(0,Math.min(.05,dt))*5);
    if(this.gain>0)this.reducedFrames++;
    if(previous>0 && this.gain===0)this.restored++;
    return this.gain;
  }
  trimReturns<T>(entries: T[], recycle: (entry: T) => void) {
    const count=Math.max(0,entries.length-this.returningLimit);
    for(const entry of entries.splice(0,count))recycle(entry);
    this.shortenedReturns+=count;
  }
  get active() { return this.gain>0; }
  get strength() { return this.gain; }
  snapshot() { return {active:this.active,strength:this.gain,returningLimit:this.returningLimit,
    shortenedReturns:this.shortenedReturns,reducedFrames:this.reducedFrames,restored:this.restored}; }
}
