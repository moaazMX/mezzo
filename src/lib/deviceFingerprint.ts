// Device fingerprinting utility
// Creates a unique identifier for the device based on browser characteristics

export function generateDeviceFingerprint(): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.textBaseline = 'top';
    ctx.font = '14px "Arial"';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('Device fingerprint', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('Device fingerprint', 4, 17);
  }

  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
    canvas.toDataURL(),
    navigator.hardwareConcurrency || '',
    navigator.deviceMemory || '',
    navigator.platform,
    window.localStorage ? 'localStorage' : '',
    window.sessionStorage ? 'sessionStorage' : '',
  ].join('|');

  // Create a simple hash
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return Math.abs(hash).toString(36);
}

export function getStoredDeviceFingerprint(): string | null {
  return localStorage.getItem('device_fingerprint');
}

export function storeDeviceFingerprint(fingerprint: string): void {
  localStorage.setItem('device_fingerprint', fingerprint);
}

export function getOrCreateDeviceFingerprint(): string {
  let fingerprint = getStoredDeviceFingerprint();
  if (!fingerprint) {
    fingerprint = generateDeviceFingerprint();
    storeDeviceFingerprint(fingerprint);
  }
  return fingerprint;
}
