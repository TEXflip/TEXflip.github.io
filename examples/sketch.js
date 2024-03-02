let engine, world, font, ctx;

// PARAMS
const PARTICLE_RADIUS = 8;
const CELL_SIZE = 20;
const PARTICLES_NUMBER = 1000;
const ATTRACTORS_SEPARATION = 12;

let pathsInfo = [],
	pathsPoints = [],
	neighMat,
	paths,
	diagrams = [],
	fontLoadComplete = false;

//#region classes
class V_ {
	static dist(a, b) {
		let x = b.x - a.x, y = b.y - a.y;
		return Math.sqrt(x * x + y * y);
	}
	static diff(a, b) {
		return { x: a.x - b.x, y: a.y - b.y };
	}
	static sum(a, b) {
		return { x: b.x + a.x, y: b.y + a.y };
	}
	static magn(a) {
		return Math.sqrt(a.x * a.x + a.y * a.y);
	}
	static versor(a) {
		let m = this.magn(a);
		return { x: a.x / m, y: a.y / m };
	}
	static mult(a, s) {
		return { x: a.x * s, y: a.y * s }
	}
	static div(a, s) {
		return { x: a.x / s, y: a.y / s }
	}
	static isInsideBBox(a, bbox) {
		return false;
	}
}

class NeighbourMatrix {
	constructor(width, height, cellDim = 10) {
		this.width = width;
		this.height = height;
		this.cols = parseInt(width / cellDim);
		this.rows = parseInt(height / cellDim);
		this.cellDim = cellDim;
		this.matrix = [];
		for (let i = 0; i < this.cols; i++)
			this.matrix.push(new Array(this.rows));
	}
	toIndex(x) {
		return parseInt(x / this.cellDim);
	}
	toCell(point) {
		return { iX: this.toIndex(point.x), iY: this.toIndex(point.y) }
	}
	addPoint(x, y) {
		let iX = this.toIndex(x);
		let iY = this.toIndex(y);
		if (iX < 0 || iX >= this.cols || iY < 0 || iY >= this.rows)
			return;
		if (this.matrix[iX][iY] == undefined)
			this.matrix[iX][iY] = []
		this.matrix[iX][iY].push({ x: x, y: y });
	}
	existCell(x, y) {
		let iX = this.toIndex(x);
		let iY = this.toIndex(y);
		return this.#existCell_I(iX, iY);
	}
	#existCell_I(iX, iY) {
		if (iX < 0 || iX >= this.cols || iY < 0 || iY >= this.rows || this.matrix[iX][iY] == undefined)
			return false;
		return true;
	}
	#generator = function* () {
		let curr = { x: 0, y: 0, it: 0 };
		yield curr;
		while (true) {
			curr.x++;
			curr.y++;
			curr.it++;
			for (let l = 1; l <= curr.it * 2; l++) {
				curr.x--;
				yield curr;
			}
			for (let l = 1; l <= curr.it * 2; l++) {
				curr.y--;
				yield curr;
			}
			for (let l = 1; l <= curr.it * 2; l++) {
				curr.x++;
				yield curr;
			}
			for (let l = 1; l <= curr.it * 2; l++) {
				curr.y++;
				yield curr;
			}
		}
	}
	nearest(point) {
		let iX = this.toIndex(point.x);
		let iY = this.toIndex(point.y);
		let offsetGen = this.#generator(), maxIt = 0, minDist = 1e9, minPoint = undefined, off = { x: 0, y: 0, it: 0 };

		while (!(minPoint != undefined && maxIt < off.it) && off.it < Math.max(this.cols, this.rows)) {
			off = offsetGen.next().value;
			if (this.#existCell_I(iX + off.x, iY + off.y)) {
				for (const p of this.matrix[iX + off.x][iY + off.y]) {
					let d = V_.dist(p, point)
					if (d < minDist) {
						minDist = d;
						if (minPoint == undefined)
							maxIt = off.it;
						minPoint = p;
					}
				}
			}
		}

		return minPoint;
	}
	precNearest(prec, point, area=1){
		let iX = this.toIndex(point.x);
		let iY = this.toIndex(point.y);
		let offsetGen = this.#generator(), maxIt = 0, minDist = 1e9, minPoint = undefined, off = { x: 0, y: 0, it: 0 };

		
	}
}

class Particle {
	constructor() {
		if (arguments.length == 2) {
			this.r = arguments[1];
			if (arguments[0].x == undefined) {
				let ranges = arguments[0];
				let x = Math.random() * (ranges[1] - this.r * 2 + 1) + ranges[0] + this.r;
				let y = Math.random() * (ranges[3] - this.r * 2 + 1) + ranges[2] + this.r;
				this.body = Matter.Bodies.circle(x, y, this.r / 2);
				Matter.Composite.add(world, this.body)
			}
			else {
				let pos = arguments[0];
				this.body = Matter.Bodies.circle(pos.x, pos.y, this.r / 2);
				Matter.Composite.add(world, this.body)
			}
		}
		if (arguments.length == 3) {
			this.r = arguments[2];
			this.body = Matter.Bodies.circle(arguments[0], arguments[1], this.r / 2);
			Matter.Composite.add(world, this.body)
		}
		this.precNear = undefined;
	}
	draw() {
		circle(this.body.position.x, this.body.position.y, this.r)
	}
	update() {
		let point = neighMat.nearest(this.body.position);
		this.precNear = point;
		this.body.force = V_.mult(V_.versor(V_.diff(point, this.body.position)), 1e-5);
	}
	/**update() {
		let minIndex = 0, myp = this.body.position;
		if (this.precNear == -1) {
			let prec = 0, precI = 0, d;
			for (const i in pathsInfo) {
				d = V_.dist(pathsInfo[i].centre, myp);
				if (i > 0 && d > prec) {
					minIndex = precI;
					break;
				}
				prec = d;
				precI = i;
			}
			if (prec == d)
				minIndex = pathsInfo.length - 1
		}
		else {
			let dl = V_.dist(pathsInfo[this.precNear - 1].centre, myp);
			let dc = V_.dist(pathsInfo[this.precNear].centre, myp);
			let dr = V_.dist(pathsInfo[this.precNear + 1].centre, myp);
			minIndex = dc > dl ? this.precNear - 1 : dc > dr ? this.precNear + 1 : this.precNear;
		}
		let bb = pathsInfo[minIndex].bbox;

		if (bb.x1 < myp.x && myp.x < bb.x2 && bb.y1 < myp.y && myp.y < bb.y2) {
			let minD = 1e9, minI = 0, d = 1;
			for (const i in pathsInfo[minIndex].points) {
				d = V_.dist(pathsInfo[minIndex].points[i], myp);
				if (d < minD) {
					minD = d;
					minI = i;
				}
			}
			this.body.force = V_.mult(V_.versor(V_.diff(pathsInfo[minIndex].points[minI], myp)), 1e-6);
		}
		else
			this.body.force = V_.mult(V_.versor(V_.diff(pathsInfo[minIndex].centre, myp)), 1e-5);
	}*/
}

class ParticleSwarm {
	/**
	 * 
	 * @param {number} n 
	 * @param {number[]} ranges 
	 */
	constructor(n, ranges) {
		this.r = PARTICLE_RADIUS;
		this.particles = [];
		for (let i = 0; i < n; i++)
			this.particles.push(new Particle(ranges, this.r));
	}
	update() {
		for (const p of this.particles)
			p.update();
	}
	draw() {
		for (const p of swarm.particles)
			p.draw();
	}
	add(x, y) {
		this.particles.push(new Particle(x, y, this.r));
	}
}
//#endregion

let fontPromise;
function preload() {
	fontPromise = opentype.load('lib/ArialCE.ttf');
}

let swarm, loaded = false;
function setup() {
	let dimHeight = 500
	createCanvas(windowWidth, dimHeight);
	frameRate(60);

	ctx = document.getElementById('defaultCanvas0').getContext('2d');

	engine = Matter.Engine.create();
	engine.gravity.y = 0;
	world = engine.world;

	swarm = new ParticleSwarm(PARTICLES_NUMBER, [0, 1500, 0, height]);
	Matter.Runner.run(engine);

	fontPromise.then(fontLoaded => {
		font = fontLoaded;
		// glyphList = font.stringToGlyphs('Michele Tessari')
		paths = font.getPaths('Michele Tessari', 100, 300, 200)

		let voronoi = new Voronoi();

		let bboxes = [];
		for (const path of paths) {
			let bboxOrig = path.getBoundingBox();
			let ext = 10; // extend the bounding box to avoid points on the borders
			let bbox = { xl: bboxOrig.x1 - ext, xr: bboxOrig.x2 + ext, yt: bboxOrig.y1 - ext, yb: bboxOrig.y2 + ext };

			let sites = [], cmds = path.commands

			for (let i in cmds) {
				let j = (i - 1);
				if (cmds[i].x !== undefined) {
					sites.push({ x: cmds[i].x, y: cmds[i].y });
					if (j >= 0 && cmds[i].type != "M" && cmds[j].x !== undefined) {
						let d = V_.dist(cmds[i], cmds[j])
						let maxLength = ATTRACTORS_SEPARATION;
						if (d > maxLength) {
							let l = d / parseInt(d / maxLength);
							let versor = V_.versor(V_.diff(cmds[i], cmds[j]))
							for (let k = l; k < d; k += l) {
								let newPoint = V_.sum(cmds[j], V_.mult(versor, k));
								sites.push(newPoint);
							}
						}
					}
				}
			}
			if (sites.length > 0) {
				bboxes.push(bboxOrig);
				pathsPoints.push(sites);
			}
			diagrams.push(voronoi.compute(sites, bbox));
		}

		let off = 0;
		for (let i in diagrams) {
			let vertices = diagrams[i].vertices;
			let pathData = paths[i].toPathData(5);
			let innerPoints = [];

			for (const p of vertices)
				if (pointInSvgPath(pathData, p.x, p.y))
					if (p.x !== undefined)
						innerPoints.push(p);

			let centre = { x: 0, y: 0 };
			for (const p of innerPoints)
				centre = V_.sum(centre, p);
			centre = V_.div(centre, innerPoints.length);

			if (innerPoints.length > 0) {
				let obj = {
					centre: centre,
					points: innerPoints,
					bbox: bboxes[i - off]
				}
				pathsInfo.push(obj);
			}
			else
				off++;
		}

		neighMat = new NeighbourMatrix(windowWidth, dimHeight, CELL_SIZE);

		for (const path of pathsInfo)
			for (const p of path.points)
				neighMat.addPoint(p.x, p.y);
		console.log(neighMat.matrix)
		loaded = true;
	})

}
let nearestPoint = undefined;
function draw() {
	if (loaded) {
		background(255);
		noStroke();
		fill(255, 204, 0);
		swarm.draw();

		/**for (const p of paths) {
			p.draw(ctx)
		}*/


		/** for (const diagram of diagrams)
			for (const p of diagram.edges)
				line(p.va.x, p.va.y, p.vb.x, p.vb.y)

		for (const sites of pathsPoints)
			for (const p of sites)
				circle(p.x, p.y, 10) */

		/**for (const path of pathsInfo) {
			let bb = path.bbox;
			line(bb.x1, bb.y2, bb.x2, bb.y2)
			line(bb.x2, bb.y1, bb.x2, bb.y2)
			line(bb.x1, bb.y1, bb.x2, bb.y1)
			line(bb.x1, bb.y1, bb.x1, bb.y2)
		}*/


		// fill(255, 25, 0);
		// for (const points of pathsInfo)
		// 	for (const p of points.points)
		// 		circle(p.x, p.y, 10)

		fill(0, 0, 255)
		if (nearestPoint != undefined)
			circle(nearestPoint.x, nearestPoint.y, 10);

		swarm.update();
		Matter.Engine.update(engine, 16.666);
	}
}

function windowResized() {
	resizeCanvas(windowWidth, 500);
}

function mousePressed() {
	swarm.add(mouseX, mouseY, 10)
}
function mouseMoved() {
	nearestPoint = neighMat.nearest({ x: mouseX, y: mouseY })
}