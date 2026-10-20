/** Project wording uses the bundled MiSans font, without licensed phrase artwork. */
export class BootLettering {
  private value = "";
  constructor(private host: HTMLElement, _keys: string[]) { host.textContent = ""; }
  setText(value: string) {
    if (value !== this.value) { this.value = value; this.host.textContent = value; }
    return this;
  }
}
