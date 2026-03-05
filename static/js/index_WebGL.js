import * as THREE from "three";
import { OrbitControls } from 'jsm/controls/OrbitControls.js';
import { getFresnelMat } from "../src/getFresnelMat.js";
import { GLTFLoader } from 'jsm/loaders/GLTFLoader.js';
import getStarfield from "../src/getStarfield.js";


// Fetch the JSON locations file
let locations = [];
fetch('static/src/locations.json')
  .then(response => response.json())
  .then(data => {
    locations = data;

    //variable to store last text mesh
    let lastTextMesh = null;
    //set window variables
    //const w = window.innerWidth;
    //const h = window.innerHeight;
    const canvasContainer = document.getElementById("globeCanvas");
    let w = canvasContainer.offsetWidth;
    let h = canvasContainer.offsetHeight;
    let totalEarthRotation = 0;
    //Set up Scene/camera/renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
    camera.position.z = 40;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, canvas: canvasContainer });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    //document.body.appendChild(renderer.domElement);
    THREE.ColorManagement.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    //mouse and raycaster
    const mouseLoc = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    raycaster.camera = camera

    //Create Earth
    const earthGroup = new THREE.Group();
    scene.add(earthGroup);
    new OrbitControls(camera, renderer.domElement);
    const detail = 12;
    const loader = new THREE.TextureLoader();
    const geometry = new THREE.IcosahedronGeometry(20, detail);
    //const halfSphere = new THREE.SphereGeometry(20.1,30,30,0,Math.PI,0,Math.PI);

    // Load Textures
    const material = new THREE.MeshPhongMaterial({
      map: loader.load("textures/planets/earth_day_4096.jpg"),
      //specularMap: loader.load("static/textures/planets/earth_specular_4096.jpg"),
      bumpMap: loader.load("textures/planets/earth_bump_roughness_clouds_4096.jpg"),
      bumpScale: 2,
    });
    const earthMesh = new THREE.Mesh(geometry, material);
    earthGroup.add(earthMesh);

    // Night Lights on Earth
    //const lightsMat = new THREE.MeshBasicMaterial({
    //  map: loader.load("static/textures/8k_earth_nightmap.jpg"),
    //  blending: THREE.AdditiveBlending,
    //});
    //const lightsMesh = new THREE.Mesh(geometry, lightsMat);
    //earthGroup.add(lightsMesh);

    // Add Starfield
    const starfield = getStarfield({ numStars: 20000 });
    starfield.scale.set(3, 3, 3); // Scale the starfield to make it larger
    scene.add(starfield);


    // Clouds just above earth
    // Use only the blue channel of the clouds texture for alpha
    const cloudsTexture = loader.load("textures/planets/earth_bump_roughness_clouds_4096.jpg");
    const cloudsMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: cloudsTexture }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          vec4 tex = texture2D(map, vUv);
          // Use blue channel as alpha, white color for clouds
          float cloudAlpha = tex.b * 0.3; // Reduce cloud cover by scaling alpha
          gl_FragColor = vec4(1.0, 1.0, 1.0, cloudAlpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    const cloudsMesh = new THREE.Mesh(geometry, cloudsMat);
    cloudsMesh.scale.setScalar(1.003);
    earthGroup.add(cloudsMesh);

    // Blue glow around earth
    const fresnelMat = getFresnelMat();
    const glowMesh = new THREE.Mesh(geometry, fresnelMat);
    glowMesh.scale.setScalar(1.01);
    earthGroup.add(glowMesh);

    // Add hemisphere light
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff,2);
    scene.add(hemiLight);

    // get ISS model
    const gltfloader = new GLTFLoader();
    let iss = null;
    let isslatitude = 0;
    let isslongitude = 0;
    gltfloader.load('static/models/ISS_stationary.glb', async (gltf) => {
      iss = gltf.scene;
      iss.traverse((child) => {
        if (child.isMesh) {
          child.geometry.center();
        }
      });
      iss.scale.set(0.02, 0.02, 0.02);
      setISSPosition(iss);
      await scene.add(iss);
      setInterval(setISSPosition, 5000, iss);
    });

    // Add locations to the earth
    const locationsMesh = [];
    const labels = [];
    const labelHeight = 2;

    for (let i = 0; i < locations.length; i++) {
      const coords = getCartesianCoords(locations[i].latitude, locations[i].longitude, 20);
      // Calculate the normal vector to the surface of the sphere at the given point      
      const normal = new THREE.Vector3(coords.x, coords.y, coords.z).normalize();

      const cylinderGeometry = new THREE.CylinderGeometry(.05, .05, labelHeight, 32);
      // Translate the geometry so that the tip is at the origin
      cylinderGeometry.translate(0, labelHeight / 2, 0);

      locationsMesh[i] = new THREE.Mesh(
        cylinderGeometry,
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );

      locationsMesh[i].position.set(coords.x, coords.y, coords.z);

      // Align the cylinder with the surface normal
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      locationsMesh[i].quaternion.copy(quaternion);

      // Translate the cylinder so that the tip is at the surface
      locationsMesh[i].position.add(normal.clone().multiplyScalar(labelHeight / 2)); // labelHeight/2 is half the height of the cylinder
      scene.add(locationsMesh[i]);

      // Add text label
      labels[i] = textLabel(locations[i].name, coords.x, coords.y, coords.z, normal);
      labels[i].position.set(coords.x, coords.y, coords.z);
      scene.add(labels[i]);
      if (labels.length > 1) {
        ajustForOverlappingLabels(labels);
      }
    }

    // Function to check for overlapping labels
    function ajustForOverlappingLabels(labels) {
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const distance = labels[i].position.distanceTo(labels[j].position);
          if (distance < labels[i].scale.y / 2) {
            // Move the labels 
            const overlapAmount = labels[i].scale.y / 2;
            labels[i].position.add(new THREE.Vector3(0, 0, overlapAmount));
            labels[i].userData = { overlap: overlapAmount };
            labels[j].position.add(new THREE.Vector3(0, 0, -overlapAmount));
            labels[j].userData = { overlap: -overlapAmount };
          } else {
            // dont overwrite the overlap value if it is already set
            if (labels[i].userData.overlap === undefined) {
              labels[i].userData = { overlap: 0 };
              labels[j].userData = { overlap: 0 };
            }
          }
        }
      }
    }

    // Calculate the x,y,z coordinates of a point on a sphere
    function getCartesianCoords(lat, lon, radius) {
      const phi = (90 - lat) * Math.PI / 180;
      const theta = (lon - 0.5) * Math.PI / 180;
      const x = -radius * Math.sin(phi) * Math.cos(theta);
      const z = radius * Math.sin(phi) * Math.sin(theta);
      const y = radius * Math.cos(phi);
      return { x, y, z };
    }

    //function to create text label
    function textLabel(text, x, y, z, normal) {
      // Create the label
      const labelTexture = new THREE.CanvasTexture(createLabelCanvas(text, 'rgba(22, 255, 0, 1.0)'));
      const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture });
      const label = new THREE.Sprite(labelMaterial);

      // Scale the sprite to make it bigger
      label.scale.set(5, 2.5, 10); // Adjust the scale values as needed to make the label bigger or smaller

      // Position the label at the end of the cylinder + .2 unit along the normal vector
      label.position.set(x, y, z);
      label.position.add(normal.clone().multiplyScalar(labelHeight + .2));
      return label;
    }

    function createLabelCanvas(text, color) {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = 256; // Set canvas width
      canvas.height = 128;// Set canvas height to accommodate multiple lines
      context.font = 'Bold 20px Arial';
      context.fillStyle = color;
      //context.fillText(text, 0, 80);

      // Function to wrap text
      function wrapText(context, text, x, y, maxWidth, lineHeight) {
        const words = text.split(' ');
        let line = '';
        for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + ' ';
          const metrics = context.measureText(testLine);
          const testWidth = metrics.width;
          if (testWidth > maxWidth && n > 0) {
            const lineWidth = context.measureText(line).width;
            context.fillText(line, (canvas.width - lineWidth) / 2, y); //centre text 
            line = words[n] + ' ';
            y += lineHeight;
          } else {
            line = testLine;
          }
        }
        const lineWidth = context.measureText(line).width;
        context.fillText(line, (canvas.width - lineWidth) / 2, y); //centre text
      }

      // Wrap and draw the text
      wrapText(context, text, 10, 50, canvas.width - 20, 20); // Adjust x, y, maxWidth, and lineHeight as needed


      return canvas;
    }

    // Update Label Positions
    function updateLabelPositions(rotationAmount) {
      for (let i = 0; i < locations.length; i++) {
        locations[i].longitude += rotationAmount * 180 / Math.PI;
        const coords = getCartesianCoords(locations[i].latitude, locations[i].longitude, 20);
        locationsMesh[i].position.set(coords.x, coords.y, coords.z);

        // Recalculate the surface normal
        const normal = new THREE.Vector3(coords.x, coords.y, coords.z).normalize();

        // Align the cylinder with the surface normal
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        locationsMesh[i].quaternion.copy(quaternion);

        // Update the label position
        labels[i].position.set(coords.x, coords.y, coords.z);
        labels[i].position.add(normal.clone().multiplyScalar(labelHeight + .2));
        // if labels overlap then move y by overlap amount
        if (labels[i].userData.overlap != 0) {
          labels[i].position.add(new THREE.Vector3(0, 0, labels[i].userData.overlap));
        }
      }
    }

    async function setISSPosition(iss) {
      try {
        const response = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
        const data = await response.json();
        const lat = parseFloat(data.latitude);
        const lon = parseFloat(data.longitude);
        const coords = getCartesianCoords(lat, lon, 21.5);
        isslatitude = lat;
        isslongitude = lon + (totalEarthRotation * 180 / Math.PI);
        iss.position.set(coords.x, coords.y, coords.z);
        //console.log(coords);
      } catch (error) {
        console.error('Error loading JSON:', error);
      }
    }
    // Update Label Positions
    function updateISSPosition(rotationAmount) {
      if (iss) {
        isslongitude += rotationAmount * 180 / Math.PI;
        const coords = getCartesianCoords(isslatitude, isslongitude, 21.5);
        iss.position.set(coords.x, coords.y, coords.z);
        //iss face origin
        iss.lookAt(0, 0, 0);
      } else {
        console.log('ISS not loaded yet');
      }
    }


    // Animation Loop
    function animate() {
      requestAnimationFrame(animate);
      const rotationAmount = 0.0002;

      // Update the total rotation amount
      totalEarthRotation += rotationAmount;
      if (totalEarthRotation > 2 * Math.PI) {
        totalEarthRotation = 0;
      }

      // Amimate locations and labels
      updateLabelPositions(rotationAmount);
      updateISSPosition(rotationAmount);
     
      // Rotate the earth, lights, clouds, and glow
      earthMesh.rotation.y += rotationAmount;
      //lightsMesh.rotation.y += rotationAmount;
      cloudsMesh.rotation.y += rotationAmount * 1.5;
      glowMesh.rotation.y += rotationAmount;

      // Render the scene
      renderer.render(scene, camera);
    }

    // Mouse over event
    function onMouseMove(event) {
      // calculate pointer position in normalized device coordinates for Raycaster
      // (-1 to +1) for both components
      const rect = renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      mouseLoc.x = (x / w) * 2 - 1;
      mouseLoc.y = - (y / h) * 2 + 1;
      raycaster.setFromCamera(mouseLoc, camera);
      for (let i = 0; i < locations.length; i++) {
        const intersects = raycaster.intersectObjects([labels[i]]);
        if (intersects.length > 0) {
          // set colour to yellow
          const newTexture = createLabelCanvas(locations[i].name, 'rgba(255, 255, 0, 1.0)');
          labels[i].material.map = new THREE.CanvasTexture(newTexture);
          labels[i].material.needsUpdate = true;
          // Set text label to the current location
          let myDiv = document.getElementById("launches");
          myDiv.innerHTML ="<p>" + locations[i].name + "</p>" + 
            "<p># Launches: " + locations[i].count + "</p>" +
            "<p>Next Launch: " + locations[i].next_launch + "</p>";
          { break; }
        } else {
          const newTexture = createLabelCanvas(locations[i].name, 'rgba(22, 255, 0, 1.0)');
          labels[i].material.map = new THREE.CanvasTexture(newTexture);
          labels[i].material.needsUpdate = true;
        }
      }
    }

    // Mouse Click Event
    function onMouseClick(event) {
      // calculate pointer position in normalized device coordinates for Raycaster
      // (-1 to +1) for both components
      const rect = renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      mouseLoc.x = (x / w) * 2 - 1;
      mouseLoc.y = - (y / h) * 2 + 1;
      raycaster.setFromCamera(mouseLoc, camera);
      for (let i = 0; i < locations.length; i++) {
        const intersects = raycaster.intersectObjects([labels[i]]);
        if (intersects.length > 0) {
          // Set colour to red
          const newTexture = createLabelCanvas(locations[i].name, 'rgba(255, 0, 0, 1.0)');
          labels[i].material.map = new THREE.CanvasTexture(newTexture);
          labels[i].material.needsUpdate = true;

          // Speak Name of Location
          const utterance = new SpeechSynthesisUtterance(locations[i].name);
          window.speechSynthesis.speak(utterance);

          //Call Reporting for location
          let location_url = "https://www.rocketspotter.com/location?id=".concat(locations[i].id)
          window.open(location_url);

          { break; }
        } else {
          const newTexture = createLabelCanvas(locations[i].name, 'rgba(22, 255, 0, 1.0)');
          labels[i].material.map = new THREE.CanvasTexture(newTexture);
          labels[i].material.needsUpdate = true;
        }
      }
    }
    // Mouse up Event
    function onMouseUp(event) {
      // Remove the text label
      if (lastTextMesh) {
        scene.remove(lastTextMesh);
        lastTextMesh = null;
      }
    }

    // Start the animation loop
    animate();

    // Resize event
    function handleWindowResize() {
      canvasContainer.style.width = '100%';
      canvasContainer.style.height = '100%';
      w = canvasContainer.offsetWidth;
      h = canvasContainer.offsetHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      updateLabelPositions(0);
    }
    // Event listeners
    window.addEventListener('resize', handleWindowResize, false);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('click', onMouseClick);
    window.addEventListener('mouseup', onMouseUp);
  })
  // Catch any errors and log them to the console
  .catch(error => console.error('Error loading JSON:', error));