const state = {
  styleProfiles: new Map(),
  instagramBatches: new Map(),
  drafts: new Map(),
};

export function saveStyleProfile(userId, profile) {
  state.styleProfiles.set(userId, profile);
}

export function getStyleProfile(userId) {
  return state.styleProfiles.get(userId) || null;
}

export function saveInstagramBatch(userId, items) {
  state.instagramBatches.set(userId, items);
}

export function getInstagramBatch(userId) {
  return state.instagramBatches.get(userId) || [];
}

export function saveDraft(userId, draft) {
  state.drafts.set(userId, draft);
}

export function getDraft(userId) {
  return state.drafts.get(userId) || null;
}
