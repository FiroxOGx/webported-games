// Bypass completo de PokiSDK
window.PokiSDK = {
  init: () => Promise.resolve(true),
  initWithLevel: () => Promise.resolve(true),
  customEvent: () => {},
  gameLoadingStart: () => {},
  gameLoadingFinished: () => {},
  gameLoadingProgress: () => {},
  gameplayStart: () => {},
  gameplayStop: () => {},
  happyTime: () => {},
  commercialBreak: () => Promise.resolve(true),
  rewardedBreak: () => Promise.resolve(true),
  displayAd: () => {},
  destroyAd: () => {},
  setDebug: () => {},
  getURLParam: () => ""
};

window.addEventListener('beforeunload', (event) => {
  event.stopImmediatePropagation();
});