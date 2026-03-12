import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCDrXohcOJZcsMgqmvXakk4SJnaj7hgzDo",
    authDomain: "veriphoto-2c95d.firebaseapp.com",
    projectId: "veriphoto-2c95d",
    storageBucket: "veriphoto-2c95d.firebasestorage.app",
    messagingSenderId: "1005950289147",
    appId: "1:1005950289147:web:a8fddbf7ab082f99335c5e"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let selectedFile;
let coordsActuales = null;
const statusTxt = document.getElementById("status");

// GPS Directo
if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition((pos) => {
        coordsActuales = pos.coords;
        statusTxt.innerText = "GPS Conectado ✅";
    }, (err) => {
        statusTxt.innerText = "Error: Activa ubicación";
    });
}

document.getElementById("cameraInput").addEventListener("change", (e) => {
    selectedFile = e.target.files[0];
    statusTxt.innerText = "Foto lista para subir";
});

window.subirEvidencia = async function() {
    if(!selectedFile || !coordsActuales) return alert("Faltan datos");

    try {
        const folio = "VP-" + Date.now();
        await addDoc(collection(db, "evidencias"), {
            folio: folio,
            lat: coordsActuales.latitude,
            lon: coordsActuales.longitude,
            fecha_servidor: serverTimestamp()
            // (Aquí faltaban el hash y la compresión que agregamos después)
        });
        alert("¡Guardado! Folio: " + folio);
    } catch (e) {
        alert("Error de conexión");
    }
};
