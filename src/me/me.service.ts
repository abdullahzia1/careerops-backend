import { Injectable } from '@nestjs/common';
import { StoreService } from '../store/store.service';

@Injectable()
export class MeService {
  constructor(private readonly store: StoreService) {}

  getMe() {
    const { activeCvVersionId } = this.store.getActiveCvPointers();
    const { activeProfileSnapshotId } = this.store.activeProfilePointers();
    const cvVersions = this.store.listCvVersions();
    const profileSnapshots = this.store.listProfileSnapshots();

    const activeCv =
      activeCvVersionId !== null
        ? (cvVersions.find((v) => v.id === activeCvVersionId) ?? null)
        : null;
    const activeProfile =
      activeProfileSnapshotId !== null
        ? (profileSnapshots.find((v) => v.id === activeProfileSnapshotId) ?? null)
        : null;

    return {
      userId: 'dev-user',
      activeCvVersionId,
      activeProfileSnapshotId,
      cvVersions,
      profileSnapshots,
      activeCvMarkdown: activeCv?.content ?? null,
      activeProfile: activeProfile?.data ?? null,
    };
  }

  patchCv(content: string, ifMatch?: string) {
    return this.store.patchCvMarkdown(content, ifMatch ?? null);
  }

  patchProfile(data: Record<string, unknown>, ifMatch?: string) {
    return this.store.patchProfileSnapshot(data, ifMatch ?? null);
  }
}
