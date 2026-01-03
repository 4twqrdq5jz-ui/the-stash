// ======================
// FIREBASE INIT (YOUR CONFIG)
// ======================
var firebaseConfig = {
  apiKey: "AIzaSyB473Di3cjCiSYAT_fVhk8PMP09BgwF2NA",
  authDomain: "mysterybyjae.firebaseapp.com",
  databaseURL: "https://mysterybyjae-default-rtdb.firebaseio.com",
  projectId: "mysterybyjae",
  storageBucket: "mysterybyjae.firebasestorage.app",
  messagingSenderId: "430326742522",
  appId: "1:430326742522:web:4496e80aa1cf84a0ec3843"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.database();
const storage = firebase.storage();

// ======================
// AUTH GUARD
// ======================
auth.onAuthStateChanged(user => {
  if (!user) {
    alert("You must be signed in to upload.");
    window.location.href = "index.html";
  }
});

// ======================
// UPLOAD HANDLER
// ======================
document.getElementById("uploadForm").addEventListener("submit", async e => {
  e.preventDefault();

  const user = auth.currentUser;
  if (!user) return;

  const title = document.getElementById("title").value;
  const videoFile = document.getElementById("videoFile").files[0];
  const thumbFile = document.getElementById("thumbnailFile").files[0];
  const status = document.getElementById("status");

  status.textContent = "Uploading…";

  try {
    const videoId = db.ref("videos").push().key;

    const videoRef = storage.ref(`videos/${videoId}.mp4`);
    const thumbRef = storage.ref(`thumbnails/${videoId}.jpg`);

    await videoRef.put(videoFile);
    await thumbRef.put(thumbFile);

    const videoURL = await videoRef.getDownloadURL();
    const thumbURL = await thumbRef.getDownloadURL();

    await db.ref(`videos/${videoId}`).set({
      title,
      videoURL,
      thumbnail: thumbURL,
      author: user.displayName,
      authorImage: user.photoURL,
      uid: user.uid,
      views: 0,
      timeAgo: "Just now",
      createdAt: Date.now()
    });

    status.textContent = "Upload complete!";
    e.target.reset();

  } catch (err) {
    console.error(err);
    status.textContent = "Upload failed.";
  }
});
