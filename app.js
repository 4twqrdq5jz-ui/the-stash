// Initialize Firebase
var firebaseConfig = {
  apiKey: "AIzaSyB473Di3cjCiSYAT_fVhk8PMP09BgwF2NA",
  authDomain: "mysterybyjae.firebaseapp.com",
  databaseURL: "https://mysterybyjae-default-rtdb.firebaseio.com",
  projectId: "mysterybyjae",
  storageBucket: "mysterybyjae.firebasestorage.app",
  messagingSenderId: "430326742522",
  appId: "1:430326742522:web:4496e80aa1cf84a0ec3843",
  measurementId: "G-0JZEHM9VKS"
};

firebase.initializeApp(firebaseConfig);

// Authentication
const auth = firebase.auth();

// Function to sign in with Google
function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider);
}

// Function to sign out
function signOut() {
  auth.signOut();
}

// Listen for auth state changes
auth.onAuthStateChanged(user => {
  if (user) {
    console.log('User is signed in:', user);
  } else {
    console.log('No user is signed in.');
  }
});

// Load videos from Firebase Database
const db = firebase.database();
const videosRef = db.ref('videos');

videosRef.on('value', snapshot => {
  const videos = snapshot.val();
  const videosContainer = document.querySelector('.videos');
  videosContainer.innerHTML = '';

  Object.keys(videos).forEach(key => {
    const video = videos[key];
    const videoElement = document.createElement('div');
    videoElement.classList.add('video');
    videoElement.innerHTML = `
      <div class="thumbnail">
        <img src="${video.thumbnail}" alt="">
      </div>
      <div class="details">
        <div class="author">
          <img src="${video.authorImage}" alt="">
        </div>
        <div class="title">
          <h3>${video.title}</h3>
          <a href="#">${video.author}</a>
          <span>${video.views} Views • ${video.timeAgo}</span>
        </div>
      </div>
    `;
    videosContainer.appendChild(videoElement);
  });
});