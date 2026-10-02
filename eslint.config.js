// 문법 오류만 잡는 최소 설정 (js/ 대상, 브라우저 전역)
const browser = Object.fromEntries(
  ["window","document","navigator","localStorage","sessionStorage","console","performance","requestAnimationFrame","cancelAnimationFrame","setTimeout","clearTimeout","setInterval","clearInterval","fetch","Image","Audio","AudioContext","webkitAudioContext","URL","Blob","Event","CustomEvent","DeviceOrientationEvent","screen","location","alert","BABYLON","caches","indexedDB","Promise","Uint8Array","Float32Array"].map(k => [k, "readonly"])
);
module.exports = [{
  files: ["js/**/*.js"],
  languageOptions: { ecmaVersion: 2021, sourceType: "script", globals: browser },
  rules: {},
}];
