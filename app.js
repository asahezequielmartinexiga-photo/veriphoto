let selectedFile;
const input = document.getElementById("cameraInput");
input.addEventListener("change", (event)=>{
selectedFile = event.target.files[0];
document.getElementById("status").innerText =
"Foto capturada";
});
