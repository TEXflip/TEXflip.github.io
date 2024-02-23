let points = [];
let delaunay, voronoi;
let video;
let started = false;

function setup() {
  createCanvas(640, 480);
  video = createCapture(VIDEO, videoReady);
  video.hide();
  video.size(640, 480);
}

function videoReady() {
  video.loop();
  init();
}

function init() {
  for (let i = 0; i < 1500; i++) {
    let x = random(width);
    let y = random(height);
    let col = video.get(x, y);
    if (random(100) > brightness(col)) {
      points.push(createVector(x, y));
    } else {
      i--;
    }
  }
  delaunay = calculateDelaunay(points);
  voronoi = delaunay.voronoi([0, 0, width, height]);

  started = true;
}

function draw() {
  background(255);

  if (started) {
    let polygons = voronoi.cellPolygons();
    let cells = Array.from(polygons);

    let centroids = new Array(cells.length);
    let weights = new Array(cells.length).fill(0);
    let counts = new Array(cells.length).fill(0);
    let avgWeights = new Array(cells.length).fill(0);
    for (let i = 0; i < centroids.length; i++) {
      centroids[i] = createVector(0, 0);
    }

    video.loadPixels();
    let delaunayIndex = 0;
    for (let i = 0; i < width; i++) {
      for (let j = 0; j < height; j++) {
        let index = (i + j * width) * 4;
        let r = video.pixels[index + 0];
        let g = video.pixels[index + 1];
        let b = video.pixels[index + 2];
        let bright = (r + g + b) / 3;
        let weight = 1 - bright / 255;
        delaunayIndex = delaunay.find(i, j, delaunayIndex);
        centroids[delaunayIndex].x += i * weight;
        centroids[delaunayIndex].y += j * weight;
        weights[delaunayIndex] += weight;
        counts[delaunayIndex]++;
      }
    }

    let maxWeight = 0;
    for (let i = 0; i < centroids.length; i++) {
      if (weights[i] > 0) {
        centroids[i].div(weights[i]);
        avgWeights[i] = weights[i] / (counts[i] || 1);
        if (avgWeights[i] > maxWeight) {
          maxWeight = avgWeights[i];
        }
      } else {
        centroids[i] = points[i].copy();
      }
    }

    for (let i = 0; i < points.length; i++) {
      points[i].lerp(centroids[i], 1);
    }

    for (let i = 0; i < points.length; i++) {
      let v = points[i];
      let index = (floor(v.x) + floor(v.y) * width) * 4;
      let r = video.pixels[index + 0];
      let g = video.pixels[index + 1];
      let b = video.pixels[index + 2];
      let sw = map(avgWeights[i], 0, maxWeight, 0, 12, true);
      strokeWeight(sw);
      point(v.x, v.y);
    }

    delaunay = calculateDelaunay(points);
    voronoi = delaunay.voronoi([0, 0, width, height]);
  }
}

function calculateDelaunay(points) {
  let pointsArray = [];
  for (let v of points) {
    pointsArray.push(v.x, v.y);
  }
  return new d3.Delaunay(pointsArray);
}
