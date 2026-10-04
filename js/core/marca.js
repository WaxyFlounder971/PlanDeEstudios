import { estado } from "./storage.js";
import { marcarCambioPendiente } from "./storage-sync.js";
import { sellarTimestamp } from "./schema.js";
import { mostrarToast } from "../ui/componentes.js";

const LOGOS = {
  folder: "imagenes/LogoAppFolder.png",
  birrete: "imagenes/LogoAppBirrete.png",
};

function colorTema() {
  const valor = getComputedStyle(document.documentElement).getPropertyValue("--accent-1").trim();
  const m = valor.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hsl(r,g,b) {
  r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0,s=0,l=(max+min)/2;
  if(d){s=d/(1-Math.abs(2*l-1));switch(max){case r:h=((g-b)/d)%6;break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4;}h/=6;if(h<0)h+=1;}
  return [h,s,l];
}
function rgbFromHsl(h,s,l) {
  const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h*6)%2-1)),m=l-c/2;let a,b,d;
  if(h<1/6){a=c;b=x;d=0;}else if(h<2/6){a=x;b=c;d=0;}else if(h<3/6){a=0;b=c;d=x;}else if(h<4/6){a=0;b=x;d=c;}else if(h<5/6){a=x;b=0;d=c;}else{a=c;b=0;d=x;}
  return [(a+m)*255,(b+m)*255,(d+m)*255];
}
async function colorizarLogo(src, destino) {
  const acento=colorTema();if(!acento||!src)return;
  try {
    const res=await fetch(src);const blob=await res.blob();const bmp=typeof createImageBitmap==="function"?await createImageBitmap(blob):await new Promise((resolve,reject)=>{const img=new Image();const temp=URL.createObjectURL(blob);img.onload=()=>{URL.revokeObjectURL(temp);resolve(img);};img.onerror=()=>{URL.revokeObjectURL(temp);reject(new Error("No se pudo leer el logo"));};img.src=temp;});
    const scale=Math.min(1,512/Math.max(bmp.width,bmp.height));const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bmp.width*scale));canvas.height=Math.max(1,Math.round(bmp.height*scale));
    const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,canvas.width,canvas.height);bmp.close?.();
    const pix=ctx.getImageData(0,0,canvas.width,canvas.height);const [ah,as,al]=hsl(...acento);
    for(let i=0;i<pix.data.length;i+=4){const alpha=pix.data[i+3]/255;if(alpha<.15)continue;const [sh,ss,sl]=hsl(pix.data[i],pix.data[i+1],pix.data[i+2]);if(ss>.24&&sl>.2&&sl<.88){const tone=Math.max(.22,Math.min(.78,al+(sl-.5)*.52));const [r,g,b]=rgbFromHsl(ah,Math.min(.9,Math.max(.55,as)),tone);pix.data[i]=r;pix.data[i+1]=g;pix.data[i+2]=b;}}
    ctx.putImageData(pix,0,0);const colored=canvas.toDataURL("image/png");destino(colored);
  } catch (_) { /* Conserva el logo original si el navegador no permite procesarlo. */ }
}
let cicloColorLogo=0;
function aplicarLogoApp() {
  const cfg = estado.datos?.configuracion;
  if (!cfg) return;
  const src = cfg.logo_app_url || LOGOS[cfg.logo_app] || LOGOS.folder;
  const aplicarSrc=(finalSrc)=>{
    document.querySelectorAll("img[data-app-logo]").forEach((img) => { if(img.src!==finalSrc)img.src=finalSrc; });
    document.querySelector("link[data-app-favicon]")?.setAttribute("href", finalSrc);
  };
  const ciclo=++cicloColorLogo;
  colorizarLogo(src,(data)=>{if(ciclo===cicloColorLogo)aplicarSrc(data);});
  aplicarSrc(src);
  document.querySelectorAll("[data-logo-app]").forEach((btn) => btn.setAttribute("aria-pressed", String(!cfg.logo_app_url && cfg.logo_app === btn.dataset.logoApp)));
}

function guardarLogo(id, dataUrl = null) {
  const cfg = estado.datos?.configuracion;
  if (!cfg) return;
  cfg.logo_app = id || "folder";
  cfg.logo_app_url = dataUrl;
  sellarTimestamp(cfg);
  marcarCambioPendiente();
  aplicarLogoApp();
}

async function prepararImagenLogo(archivo) {
  if (!archivo || !/^LogoApp/i.test(archivo.name) || !/^image\/(png|jpeg|webp)$/.test(archivo.type) || archivo.size > 8 * 1024 * 1024) {
    mostrarToast("Elige desde Descargas un archivo llamado LogoApp… en PNG, JPG o WebP (máximo 8 MB).");
    return null;
  }
  const url = URL.createObjectURL(archivo);
  try {
    const imagen = typeof createImageBitmap === "function"
      ? await createImageBitmap(archivo)
      : await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
    const escala = Math.min(1, 512 / Math.max(imagen.width, imagen.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(imagen.width * escala));
    canvas.height = Math.max(1, Math.round(imagen.height * escala));
    canvas.getContext("2d").drawImage(imagen, 0, 0, canvas.width, canvas.height);
    imagen.close?.();
    return canvas.toDataURL("image/webp", 0.86);
  } catch (_) {
    mostrarToast("No pude leer ese logo. Prueba con otro PNG, JPG o WebP.");
    return null;
  } finally { URL.revokeObjectURL(url); }
}

function inicializarSelectorLogo() {
  const selector = document.getElementById("selector-logo-app");
  if (!selector || selector.dataset.inicializado) return;
  selector.dataset.inicializado = "1";
  selector.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-logo-app]");
    if (btn) guardarLogo(btn.dataset.logoApp);
  });
  document.getElementById("input-logo-app-archivo")?.addEventListener("change", async (ev) => {
    const dataUrl = await prepararImagenLogo(ev.target.files?.[0]);
    if (dataUrl) guardarLogo("personalizado", dataUrl);
    ev.target.value = "";
  });
}

window.aplicarLogoApp = aplicarLogoApp;
export { aplicarLogoApp, inicializarSelectorLogo, prepararImagenLogo };
