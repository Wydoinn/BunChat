// One page load = at most one room membership (leaving or getting burned out
// always does a full navigation), so a single mutable object is enough here —
// no need for a store/reducer for something this small.
export const state = {
  userId: null,
  roomId: null,
  expiresAt: 0,
  imagesEnabled: true,
};
