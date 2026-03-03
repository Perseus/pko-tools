export class LatestOnly {
  private version = 0;

  begin(): number {
    this.version += 1;
    return this.version;
  }

  isLatest(version: number): boolean {
    return version === this.version;
  }

  invalidate(): void {
    this.version += 1;
  }
}
