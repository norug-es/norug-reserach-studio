import { clamavHealth, scanWithClamav } from "../lib/clamav.ts";

// EICAR es una cadena de prueba inerte reconocida por motores antivirus; no es malware.
const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

await clamavHealth();
const clean = await scanWithClamav(new TextEncoder().encode("NoRug Research Studio: control limpio"));
if (clean.status !== "clean") throw new Error(`ClamAV marcó el control limpio como ${clean.status}`);
const detected = await scanWithClamav(new TextEncoder().encode(eicar));
if (detected.status !== "infected") throw new Error("ClamAV no detectó la firma EICAR");
console.log(`ClamAV operativo: limpio=OK; EICAR=${detected.threatName}; ${detected.engineVersion}`);
