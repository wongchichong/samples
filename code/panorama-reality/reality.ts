/// <reference path="../../typings/index.d.ts"/>

// When we distribute Argon typings, we can get rid of this, but for now
// we need to shut up the Typescript compiler about missing Argon typings
declare const Argon:any;

// save some local references to commonly used classes
const Cartesian3 = Argon.Cesium.Cartesian3;
const Quaternion = Argon.Cesium.Quaternion;
const CesiumMath = Argon.Cesium.CesiumMath;

// set up Argon (unlike regular apps, we call initReality instead of init)
// Defining a protocol allows apps to communicate with the reality in a 
// reliable way. 
const app = Argon.initReality({
    config: {
        protocols: ['ael.gatech.panorama@v1'] 
    }
});

// set up THREE.  Create a scene, a perspective camera and an object
// for the user's location
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const userLocation = new THREE.Object3D;
scene.add(camera);
scene.add(userLocation);

// We use the standard WebGLRenderer when we only need WebGL-based content
const renderer = new THREE.WebGLRenderer({ 
    alpha: true, 
    logarithmicDepthBuffer: true
});

// account for the pixel density of the device
renderer.setPixelRatio(window.devicePixelRatio);
app.view.element.appendChild(renderer.domElement);

// Tell argon what local coordinate system you want.  The default coordinate
// frame used by Argon is Cesium's FIXED frame, which is centered at the center
// of the earth and oriented with the earth's axes.  
// The FIXED frame is inconvenient for a number of reasons: the numbers used are
// large and cause issues with rendering, and the orientation of the user's "local
// view of the world" is different that the FIXED orientation (my perception of "up"
// does not correspond to one of the FIXED axes).  
// Therefore, Argon uses a local coordinate frame that sits on a plane tangent to 
// the earth near the user's current location.  This frame automatically changes if the
// user moves more than a few kilometers.
// The EUS frame cooresponds to the typical 3D computer graphics coordinate frame, so we use
// that here.  The other option Argon supports is localOriginEastNorthUp, which is
// more similar to what is used in the geospatial industry
app.context.setDefaultReferenceFrame(app.context.localOriginEastUpSouth);

interface PanoramaInfo {
    url: string,
    longitude?: number,
    latitude?: number,
    height?: number,
    offsetDegrees?: number
}

interface Panorama extends PanoramaInfo {
    position:Argon.Cesium.ConstantPositionProperty,
    texture?:Promise<THREE.Texture>
}

// A map to store our panoramas
var panoramas = new Map<string, Panorama>();
var currentPano:Panorama;

// Create two pano spheres we can transition between
var sphereGeometry = new THREE.SphereGeometry(100, 32, 32);
var panoSpheres:Array<THREE.Mesh> = [new THREE.Mesh, new THREE.Mesh];
panoSpheres.forEach((mesh)=>{
    mesh.geometry = sphereGeometry;
    const material = new THREE.MeshBasicMaterial();
    material.transparent = true;
    mesh.material = material;
    userLocation.add(mesh);
})
var currentSphere = 0;

// We need to define a projection matrix for our reality view
var perspectiveProjection = new Argon.Cesium.PerspectiveFrustum();
perspectiveProjection.fov = Math.PI / 2;

// For this example, we want to control the panorama using the device orientation.
// Since we are using geolocated panoramas, we can disable location updates
app.device.locationUpdatesEnabled = false;

// Create an entity to represent the eye
const eyeEntity = new Argon.Cesium.Entity({
    orientation: new Argon.Cesium.ConstantProperty(Quaternion.IDENTITY)
})

// Creating a lot of garbage slows everything down. Not fun.
// Let's create some recyclable objects that we can use later.
const scratchCartesian = new Cartesian3;
const scratchQuaternion = new Quaternion;
const scratchArray = [];

// Reality views must raise frame events at regular intervals in order to 
// drive updates for the entire system. 
function onFrame(time, index:number) {
    
    // Get the eye position from the current panorama
    if (currentPano) {
        eyeEntity.position = currentPano.position;
    }
    
    // Get the current interface-aligned device orientation relative to the device location
    app.device.update();
    const deviceOrientation = Argon.getEntityOrientation(
        app.device.interfaceEntity, 
        time, 
        app.device.locationEntity, 
        scratchQuaternion
    );
    eyeEntity.orientation.setValue(deviceOrientation);
    
    const viewport = app.view.getMaximumViewport();
    perspectiveProjection.aspectRatio = viewport.width / viewport.height;
    const matrix = perspectiveProjection.infiniteProjectionMatrix;
        
    // By raising a frame state event, we are telling the manager how we would like
    // to render (and likewise, how we would like apps to render). However, the manager
    // may modify the view configuration depending on various conditions (i.e, 
    // whether or not a stereo viewer is being used or not, etc).
    app.reality.frameEvent.raiseEvent({
        time,
        index,
        view: {
            viewport,
            pose: Argon.getSerializedEntityPose(eyeEntity, time),
            subviews: [{
                type: Argon.SubviewType.SINGULAR,
                projectionMatrix: Argon.Cesium.Matrix4.toArray(matrix, scratchArray)
            }]
        }
    })
    app.timer.requestFrame(onFrame);
}
// We can use requestAnimationFrame, or the builtin Argon.TimerService (app.timer),
// The TimerService is more convenient as it will provide the current time 
// as a Cesium.JulianDate object which can be used directly when raising a frame event. 
app.timer.requestFrame(onFrame)


// the updateEvent is called each time the 3D world should be
// rendered, before the renderEvent.  The state of your application
// should be updated here.
app.updateEvent.addEventListener(() => {
    // get the position and orientation (the "pose") of the user
    // in the local coordinate frame.
    const userPose = app.context.getEntityPose(app.context.user);

    // assuming we know the user's pose, set the position of our 
    // THREE user object to match it
    if (userPose.poseStatus & Argon.PoseStatus.KNOWN) {
        userLocation.position.copy(userPose.position);
    }
    
    TWEEN.update();
})


// renderEvent is fired whenever argon wants the app to update its display
app.renderEvent.addEventListener(() => {
    // set the renderer to know the current size of the viewport.
    // This is the full size of the viewport, which would include
    // both views if we are in stereo viewing mode
    const viewport = app.view.getViewport();
    renderer.setSize(viewport.width, viewport.height);
    
    // there is 1 subview in monocular mode, 2 in stereo mode    
    for (let subview of app.view.getSubviews()) {
        // set the position and orientation of the camera for 
        // this subview
        camera.position.copy(subview.pose.position);
        camera.quaternion.copy(subview.pose.orientation);
        // the underlying system provide a full projection matrix
        // for the camera. 
        camera.projectionMatrix.fromArray(subview.projectionMatrix);

        // set the viewport for this view
        let {x,y,width,height} = subview.viewport;
        renderer.setViewport(x,y,width,height);

        // set the webGL rendering parameters and render this view
        renderer.setScissor(x,y,width,height);
        renderer.setScissorTest(true);
        renderer.render(scene, camera);
    }
})

// create a texture loader
const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

// when the a controlling session connects, we can communite with it to
// receive commands (or even send information back, if appropriate)
app.reality.connectEvent.addEventListener((controlSession)=>{
    controlSession.on['edu.gatech.ael.panorama.loadPanorama'] = (pano:PanoramaInfo) => {
        // if you throw an error in a message handler, the remote session will see the error!
        if (!pano.url) throw new Error('Expected an equirectangular image url!')
        
        const offsetRadians = (pano.offsetDegrees || 0) * CesiumMath.DEGREES_PER_RADIAN;
        
        let positionProperty = new Argon.Cesium.ConstantPositionProperty(undefined);
        if (Argon.Cesium.defined(pano.longitude) &&
            Argon.Cesium.defined(pano.longitude)) {
            const positionValue = Cartesian3.fromDegrees(pano.longitude, pano.latitude, pano.height || 0);
            positionProperty.setValue(positionValue, Argon.Cesium.ReferenceFrame.FIXED);
        }
        
        var texture = new Promise<THREE.Texture>((resolve)=>{
            loader.load(pano.url, function ( texture ) {
                texture.minFilter = THREE.LinearFilter;
                resolve(texture);
            });
        });
        
        panoramas.set(pano.url, {
            url: pano.url,
            longitude: pano.longitude,
            latitude: pano.latitude,
            height: pano.height,
            offsetDegrees: pano.offsetDegrees,
            position: positionProperty,
            texture
        });
        
        // We can optionally return a value (or a promise of a value) in a message handler. 
        // In this case, if three.js throws an error while attempting to load
        // the texture, the error will be passed to the remote session. Otherwise,
        // this function will respond as fulfilled when the texture is loaded. 
        return texture.then(()=>{})
    }
    controlSession.on['edu.gatech.ael.panorama.deletePanorama'] = ({url}) => {
        panoramas.delete(url);
    }
    controlSession.on['edu.gatech.ael.panorama.showPanorama'] = (options) => {
        showPanorama(options);
    }
})

interface Transition {
    easing?:string,
    duration?:number
}

interface ShowPanoramaOptions {
    url:string,
    transition:Transition,
}

function showPanorama(options:ShowPanoramaOptions) {
    const url = options.url;
    const transition:Transition = options.transition || {};
    const easing = resolve(transition.easing, TWEEN.Easing) || TWEEN.Easing.Linear.None;
    
    if (!url) throw new Error('Expected a url');
    if (!easing) throw new Error('Unknown easing: ' + easing);
    
    const panoOut = currentPano;
    const panoIn = panoramas.get(url);
    if (!panoIn) throw new Error('Unknown pano: '+ url + ' (did you forget to add the panorama first?)')
    currentPano = panoIn;
    
    // get the threejs objects for rendering our panoramas
    const sphereOut = panoSpheres[currentSphere];
    currentSphere++; currentSphere %= 2;
    const sphereIn = panoSpheres[currentSphere];
    const inMaterial = sphereIn.material as THREE.MeshBasicMaterial;
    const outMaterial = sphereOut.material as THREE.MeshBasicMaterial;
    
    // update the material for the incoming panorama
    inMaterial.map = undefined;
    inMaterial.opacity = 1;
    inMaterial.needsUpdate = true;
    panoIn.texture.then((texture)=>{
        inMaterial.map = texture;
        inMaterial.needsUpdate = true;
    })
    
    // update the pose of the pano spheres
    sphereIn.rotation.y = (panoIn.offsetDegrees || 0) * CesiumMath.RADIANS_PER_DEGREE;
    
    // negate one scale component to flip the spheres inside-out,
    // and make the incoming sphere slightly smaller so it is seen infront of
    // the outgoing sphere
    sphereIn.scale.set(-1,1,1);
    sphereOut.scale.set(-0.9,0.9,0.9);
    
    // force render order
    sphereIn.renderOrder = 0;
    sphereOut.renderOrder = 1;
    
    // fade out the old pano using tween.js!
    TWEEN.removeAll();
    var outTween = new TWEEN.Tween(outMaterial);
    outTween.to({opacity:0}, transition.duration).onUpdate(()=>{
        outMaterial.needsUpdate = true;
    }).easing(easing).start();
}

function resolve(path:string, obj, safe:boolean=true) {
    if (!path) return undefined;
    return path.split('.').reduce(function(prev, curr) {
        return !safe ? prev[curr] : (prev ? prev[curr] : undefined)
    }, obj || self)
}