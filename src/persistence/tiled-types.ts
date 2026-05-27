// Tiled JSON map format type definitions
// Reference: https://doc.mapeditor.org/en/stable/reference/json-map-format/

// --- Map ---

export interface TiledMap {
	width: number;
	height: number;
	tilewidth: number;
	tileheight: number;
	orientation?: 'orthogonal' | 'isometric' | 'staggered' | 'hexagonal';
	renderorder?: 'right-down' | 'right-up' | 'left-down' | 'left-up';
	infinite?: boolean;
	layers: TiledLayer[];
	tilesets: TiledTilesetRef[];
	backgroundcolor?: string;
	nextlayerid?: number;
	nextobjectid?: number;
	properties?: TiledProperty[];
	compressionlevel?: number;
	hexsidelength?: number;
	parallaxoriginx?: number;
	parallaxoriginy?: number;
	staggeraxis?: 'x' | 'y';
	staggerindex?: 'odd' | 'even';
	tiledversion?: string;
	version?: string | number;
	type?: string;
}

// --- Layers ---

export type TiledLayer = TiledTileLayer | TiledObjectLayer | TiledImageLayer | TiledGroupLayer;

export interface TiledTileLayer {
	type: 'tilelayer';
	name: string;
	id?: number;
	width: number;
	height: number;
	data: number[] | string; // number[] for CSV, string for base64
	encoding?: 'csv' | 'base64';
	compression?: '' | 'zlib' | 'gzip' | 'zstd';
	x?: number;
	y?: number;
	offsetx?: number;
	offsety?: number;
	opacity?: number;
	visible?: boolean;
	tintcolor?: string;
	parallaxx?: number;
	parallaxy?: number;
	properties?: TiledProperty[];
	chunks?: TiledChunk[];
	startx?: number;
	starty?: number;
	locked?: boolean;
	class?: string;
}

export interface TiledObjectLayer {
	type: 'objectgroup';
	name: string;
	id?: number;
	objects: TiledObject[];
	draworder?: 'topdown' | 'index';
	offsetx?: number;
	offsety?: number;
	opacity?: number;
	visible?: boolean;
	tintcolor?: string;
	x?: number;
	y?: number;
	properties?: TiledProperty[];
	locked?: boolean;
	class?: string;
}

export interface TiledImageLayer {
	type: 'imagelayer';
	name: string;
	id?: number;
	image: string;
	imagewidth?: number;
	imageheight?: number;
	offsetx?: number;
	offsety?: number;
	opacity?: number;
	visible?: boolean;
	tintcolor?: number;
	repeatx?: boolean;
	repeaty?: boolean;
	properties?: TiledProperty[];
	transparentcolor?: string;
	locked?: boolean;
	class?: string;
}

export interface TiledGroupLayer {
	type: 'group';
	name: string;
	id?: number;
	layers: TiledLayer[];
	offsetx?: number;
	offsety?: number;
	opacity?: number;
	visible?: boolean;
	tintcolor?: string;
	properties?: TiledProperty[];
	locked?: boolean;
	class?: string;
}

export interface TiledChunk {
	data: number[] | string;
	height: number;
	width: number;
	x: number;
	y: number;
}

// --- Objects ---

export interface TiledObject {
	id: number;
	name?: string;
	type?: string;
	x: number;
	y: number;
	width?: number;
	height?: number;
	rotation?: number;
	opacity?: number;
	visible?: boolean;
	gid?: number;
	ellipse?: boolean;
	point?: boolean;
	polygon?: { x: number; y: number }[];
	polyline?: { x: number; y: number }[];
	text?: TiledText;
	properties?: TiledProperty[];
	template?: string;
	class?: string;
	capsule?: boolean;
}

export interface TiledText {
	text: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikeout?: boolean;
	wrap?: boolean;
	color?: string;
	fontfamily?: string;
	pixelsize?: number;
	halign?: 'left' | 'center' | 'right' | 'justify';
	valign?: 'top' | 'center' | 'bottom';
	kerning?: boolean;
}

// --- Tileset ---

export interface TiledTilesetRef {
	firstgid: number;
	// External tileset reference
	source?: string;
	// Embedded tileset fields (when no source)
	name?: string;
	image?: string;
	imagewidth?: number;
	imageheight?: number;
	tilewidth?: number;
	tileheight?: number;
	tilecount?: number;
	columns?: number;
	margin?: number;
	spacing?: number;
	transparentcolor?: string;
	terrains?: TiledTerrain[];
	tiles?: TiledTileDef[];
	properties?: TiledProperty[];
	backgroundcolor?: string;
	tiledversion?: string;
	version?: string | number;
	type?: string;
	fillmode?: 'stretch' | 'preserve-aspect-fit';
	objectalignment?: string;
	tileoffset?: { x: number; y: number };
	grid?: { width: number; height: number; orientation?: string };
	wangsets?: TiledWangSet[];
	transformations?: { hflip?: boolean; vflip?: boolean; rotate?: boolean; preferuntransformed?: boolean };
	class?: string;
}

// Full tileset (after loading external source or using embedded)
export interface TiledTilesetFull {
	firstgid: number;
	name: string;
	image: string;
	imagewidth: number;
	imageheight: number;
	tilewidth: number;
	tileheight: number;
	tilecount: number;
	columns: number;
	margin?: number;
	spacing?: number;
	transparentcolor?: string;
	terrains?: TiledTerrain[];
	tiles?: TiledTileDef[];
	properties?: TiledProperty[];
	tileoffset?: { x: number; y: number };
}

// --- Terrain ---

export interface TiledTerrain {
	name: string;
	tile: number; // local tile ID representing this terrain
	properties?: TiledProperty[];
}

// --- Tile Definition ---

export interface TiledTileDef {
	id: number;
	terrain?: number[]; // [TL, TR, BL, BR], indices into terrains[] or -1
	animation?: TiledFrame[];
	image?: string; // for image collection tilesets
	imagewidth?: number;
	imageheight?: number;
	properties?: TiledProperty[];
	objectgroup?: TiledObjectLayer;
	probability?: number;
	type?: string;
	class?: string;
	x?: number; // sub-rectangle offset (since Tiled 1.9)
	y?: number;
	width?: number;
	height?: number;
}

export interface TiledFrame {
	tileid: number;
	duration: number; // milliseconds
}

// --- Wang Set ---

export interface TiledWangSet {
	name: string;
	type: 'corner' | 'edge' | 'mixed';
	tile: number;
	colors?: TiledWangColor[];
	wangtiles?: TiledWangTile[];
	properties?: TiledProperty[];
	class?: string;
}

export interface TiledWangColor {
	color: string;
	name: string;
	probability?: number;
	tile: number;
	properties?: TiledProperty[];
	class?: string;
}

export interface TiledWangTile {
	tileid: number;
	wangid: number[]; // 8-element array of color indices
}

// --- Property ---

export interface TiledProperty {
	name: string;
	type?: 'string' | 'int' | 'float' | 'bool' | 'color' | 'file' | 'object' | 'class';
	propertytype?: string;
	value?: unknown;
}

// --- GID constants ---

export const GID_FLIP_H = 0x80000000;
export const GID_FLIP_V = 0x40000000;
export const GID_FLIP_D = 0x20000000;
export const GID_MASK = 0x1FFFFFFF;
