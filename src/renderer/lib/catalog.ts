// Built-in catalog of GoTo targets. RA in decimal hours (0..24), Dec in
// decimal degrees (-90..90). Magnitudes are visual (V). Coordinates from
// standard public catalogues (J2000.0).
//
// Coverage:
// - All Messier objects M1..M110 (well-known constants — RA/Dec lifted from
//   the standard published Messier list).
// - ~30 famous NGC objects (Double Cluster, North America, Veil, Rosette,
//   Helix, Centaurus A, etc.).
//
// `alt` lists popular common names used for searching ("Andromeda Galaxy"
// matches M31, "Pleiades" matches M45). Search is case-insensitive on both
// `name` and any `alt` entries.

export type TargetType =
  | 'galaxy'
  | 'nebula'
  | 'cluster'
  | 'double-cluster'
  | 'planet'
  | 'moon';

export interface CatalogTarget {
  id: string;
  name: string;
  alt?: string[];
  ra: number;   // decimal hours, 0..24
  dec: number;  // decimal degrees, -90..90
  type: TargetType;
  magnitude: number;
}

export const TARGETS: CatalogTarget[] = [
  // --- Messier 1..110 ---
  { id: 'M1',   name: 'M1',   alt: ['Crab Nebula'],          ra:  5.5755, dec:  22.0145, type: 'nebula',  magnitude: 8.4 },
  { id: 'M2',   name: 'M2',                                   ra: 21.5575, dec:  -0.8233, type: 'cluster', magnitude: 6.3 },
  { id: 'M3',   name: 'M3',                                   ra: 13.7033, dec:  28.3772, type: 'cluster', magnitude: 6.2 },
  { id: 'M4',   name: 'M4',                                   ra: 16.3933, dec: -26.5258, type: 'cluster', magnitude: 5.6 },
  { id: 'M5',   name: 'M5',                                   ra: 15.3092, dec:   2.0814, type: 'cluster', magnitude: 5.6 },
  { id: 'M6',   name: 'M6',   alt: ['Butterfly Cluster'],     ra: 17.6700, dec: -32.2167, type: 'cluster', magnitude: 4.2 },
  { id: 'M7',   name: 'M7',   alt: ['Ptolemy Cluster'],       ra: 17.8967, dec: -34.7933, type: 'cluster', magnitude: 3.3 },
  { id: 'M8',   name: 'M8',   alt: ['Lagoon Nebula'],         ra: 18.0606, dec: -24.3867, type: 'nebula',  magnitude: 6.0 },
  { id: 'M9',   name: 'M9',                                   ra: 17.3194, dec: -18.5161, type: 'cluster', magnitude: 7.7 },
  { id: 'M10',  name: 'M10',                                  ra: 16.9528, dec:  -4.1003, type: 'cluster', magnitude: 6.6 },
  { id: 'M11',  name: 'M11',  alt: ['Wild Duck Cluster'],     ra: 18.8517, dec:  -6.2667, type: 'cluster', magnitude: 6.3 },
  { id: 'M12',  name: 'M12',                                  ra: 16.7872, dec:  -1.9483, type: 'cluster', magnitude: 6.7 },
  { id: 'M13',  name: 'M13',  alt: ['Hercules Globular Cluster', 'Great Cluster in Hercules'], ra: 16.6950, dec: 36.4611, type: 'cluster', magnitude: 5.8 },
  { id: 'M14',  name: 'M14',                                  ra: 17.6267, dec:  -3.2458, type: 'cluster', magnitude: 7.6 },
  { id: 'M15',  name: 'M15',                                  ra: 21.4997, dec:  12.1670, type: 'cluster', magnitude: 6.2 },
  { id: 'M16',  name: 'M16',  alt: ['Eagle Nebula'],          ra: 18.3128, dec: -13.7833, type: 'nebula',  magnitude: 6.0 },
  { id: 'M17',  name: 'M17',  alt: ['Omega Nebula', 'Swan Nebula'], ra: 18.3461, dec: -16.1717, type: 'nebula', magnitude: 6.0 },
  { id: 'M18',  name: 'M18',                                  ra: 18.3322, dec: -17.1000, type: 'cluster', magnitude: 7.5 },
  { id: 'M19',  name: 'M19',                                  ra: 17.0411, dec: -26.2678, type: 'cluster', magnitude: 7.5 },
  { id: 'M20',  name: 'M20',  alt: ['Trifid Nebula'],         ra: 18.0367, dec: -23.0300, type: 'nebula',  magnitude: 6.3 },
  { id: 'M21',  name: 'M21',                                  ra: 18.0683, dec: -22.5000, type: 'cluster', magnitude: 5.9 },
  { id: 'M22',  name: 'M22',                                  ra: 18.6067, dec: -23.9050, type: 'cluster', magnitude: 5.1 },
  { id: 'M23',  name: 'M23',                                  ra: 17.9472, dec: -19.0167, type: 'cluster', magnitude: 5.5 },
  { id: 'M24',  name: 'M24',  alt: ['Sagittarius Star Cloud'],ra: 18.2833, dec: -18.5500, type: 'cluster', magnitude: 4.6 },
  { id: 'M25',  name: 'M25',                                  ra: 18.5283, dec: -19.1167, type: 'cluster', magnitude: 4.6 },
  { id: 'M26',  name: 'M26',                                  ra: 18.7556, dec:  -9.3833, type: 'cluster', magnitude: 8.0 },
  { id: 'M27',  name: 'M27',  alt: ['Dumbbell Nebula'],       ra: 19.9933, dec:  22.7211, type: 'nebula',  magnitude: 7.5 },
  { id: 'M28',  name: 'M28',                                  ra: 18.4092, dec: -24.8700, type: 'cluster', magnitude: 6.8 },
  { id: 'M29',  name: 'M29',                                  ra: 20.4000, dec:  38.5333, type: 'cluster', magnitude: 7.1 },
  { id: 'M30',  name: 'M30',                                  ra: 21.6728, dec: -23.1797, type: 'cluster', magnitude: 7.2 },
  { id: 'M31',  name: 'M31',  alt: ['Andromeda Galaxy'],      ra:  0.7122, dec:  41.2691, type: 'galaxy',  magnitude: 3.4 },
  { id: 'M32',  name: 'M32',                                  ra:  0.7117, dec:  40.8650, type: 'galaxy',  magnitude: 8.1 },
  { id: 'M33',  name: 'M33',  alt: ['Triangulum Galaxy', 'Pinwheel of Triangulum'], ra: 1.5642, dec: 30.6602, type: 'galaxy', magnitude: 5.7 },
  { id: 'M34',  name: 'M34',                                  ra:  2.7000, dec:  42.7833, type: 'cluster', magnitude: 5.2 },
  { id: 'M35',  name: 'M35',                                  ra:  6.1483, dec:  24.3333, type: 'cluster', magnitude: 5.1 },
  { id: 'M36',  name: 'M36',                                  ra:  5.6056, dec:  34.1417, type: 'cluster', magnitude: 6.0 },
  { id: 'M37',  name: 'M37',                                  ra:  5.8717, dec:  32.5450, type: 'cluster', magnitude: 5.6 },
  { id: 'M38',  name: 'M38',                                  ra:  5.4783, dec:  35.8500, type: 'cluster', magnitude: 6.4 },
  { id: 'M39',  name: 'M39',                                  ra: 21.5300, dec:  48.4333, type: 'cluster', magnitude: 4.6 },
  { id: 'M40',  name: 'M40',  alt: ['Winnecke 4'],            ra: 12.3700, dec:  58.0833, type: 'cluster', magnitude: 9.7 },
  { id: 'M41',  name: 'M41',                                  ra:  6.7800, dec: -20.7167, type: 'cluster', magnitude: 4.5 },
  { id: 'M42',  name: 'M42',  alt: ['Orion Nebula'],          ra:  5.5881, dec:  -5.3911, type: 'nebula',  magnitude: 4.0 },
  { id: 'M43',  name: 'M43',  alt: ['De Mairan Nebula'],      ra:  5.5933, dec:  -5.2667, type: 'nebula',  magnitude: 9.0 },
  { id: 'M44',  name: 'M44',  alt: ['Beehive Cluster', 'Praesepe'], ra: 8.6700, dec: 19.6700, type: 'cluster', magnitude: 3.7 },
  { id: 'M45',  name: 'M45',  alt: ['Pleiades', 'Seven Sisters'],   ra: 3.7833, dec: 24.1167, type: 'cluster', magnitude: 1.6 },
  { id: 'M46',  name: 'M46',                                  ra:  7.6967, dec: -14.8167, type: 'cluster', magnitude: 6.1 },
  { id: 'M47',  name: 'M47',                                  ra:  7.6100, dec: -14.4833, type: 'cluster', magnitude: 4.4 },
  { id: 'M48',  name: 'M48',                                  ra:  8.2300, dec:  -5.7500, type: 'cluster', magnitude: 5.5 },
  { id: 'M49',  name: 'M49',                                  ra: 12.4961, dec:   8.0006, type: 'galaxy',  magnitude: 8.4 },
  { id: 'M50',  name: 'M50',                                  ra:  7.0467, dec:  -8.3333, type: 'cluster', magnitude: 5.9 },
  { id: 'M51',  name: 'M51',  alt: ['Whirlpool Galaxy'],      ra: 13.4983, dec:  47.1953, type: 'galaxy',  magnitude: 8.4 },
  { id: 'M52',  name: 'M52',                                  ra: 23.4067, dec:  61.5833, type: 'cluster', magnitude: 6.9 },
  { id: 'M53',  name: 'M53',                                  ra: 13.2153, dec:  18.1681, type: 'cluster', magnitude: 7.6 },
  { id: 'M54',  name: 'M54',                                  ra: 18.9172, dec: -30.4789, type: 'cluster', magnitude: 7.6 },
  { id: 'M55',  name: 'M55',                                  ra: 19.6664, dec: -30.9614, type: 'cluster', magnitude: 6.3 },
  { id: 'M56',  name: 'M56',                                  ra: 19.2767, dec:  30.1833, type: 'cluster', magnitude: 8.3 },
  { id: 'M57',  name: 'M57',  alt: ['Ring Nebula'],           ra: 18.8917, dec:  33.0292, type: 'nebula',  magnitude: 8.8 },
  { id: 'M58',  name: 'M58',                                  ra: 12.6286, dec:  11.8181, type: 'galaxy',  magnitude: 9.7 },
  { id: 'M59',  name: 'M59',                                  ra: 12.7000, dec:  11.6469, type: 'galaxy',  magnitude: 9.6 },
  { id: 'M60',  name: 'M60',                                  ra: 12.7278, dec:  11.5528, type: 'galaxy',  magnitude: 8.8 },
  { id: 'M61',  name: 'M61',                                  ra: 12.3650, dec:   4.4736, type: 'galaxy',  magnitude: 9.7 },
  { id: 'M62',  name: 'M62',                                  ra: 17.0203, dec: -30.1117, type: 'cluster', magnitude: 6.5 },
  { id: 'M63',  name: 'M63',  alt: ['Sunflower Galaxy'],      ra: 13.2636, dec:  42.0294, type: 'galaxy',  magnitude: 8.6 },
  { id: 'M64',  name: 'M64',  alt: ['Black Eye Galaxy'],      ra: 12.9456, dec:  21.6828, type: 'galaxy',  magnitude: 8.5 },
  { id: 'M65',  name: 'M65',  alt: ['Leo Triplet'],           ra: 11.3153, dec:  13.0922, type: 'galaxy',  magnitude: 9.3 },
  { id: 'M66',  name: 'M66',  alt: ['Leo Triplet'],           ra: 11.3372, dec:  12.9914, type: 'galaxy',  magnitude: 8.9 },
  { id: 'M67',  name: 'M67',                                  ra:  8.8400, dec:  11.8167, type: 'cluster', magnitude: 6.1 },
  { id: 'M68',  name: 'M68',                                  ra: 12.6575, dec: -26.7444, type: 'cluster', magnitude: 7.8 },
  { id: 'M69',  name: 'M69',                                  ra: 18.5231, dec: -32.3481, type: 'cluster', magnitude: 7.6 },
  { id: 'M70',  name: 'M70',                                  ra: 18.7200, dec: -32.2917, type: 'cluster', magnitude: 7.9 },
  { id: 'M71',  name: 'M71',                                  ra: 19.8961, dec:  18.7792, type: 'cluster', magnitude: 8.2 },
  { id: 'M72',  name: 'M72',                                  ra: 20.8911, dec: -12.5372, type: 'cluster', magnitude: 9.3 },
  { id: 'M73',  name: 'M73',                                  ra: 20.9817, dec: -12.6333, type: 'cluster', magnitude: 9.0 },
  { id: 'M74',  name: 'M74',  alt: ['Phantom Galaxy'],        ra:  1.6111, dec:  15.7833, type: 'galaxy',  magnitude: 9.4 },
  { id: 'M75',  name: 'M75',                                  ra: 20.1011, dec: -21.9225, type: 'cluster', magnitude: 8.5 },
  { id: 'M76',  name: 'M76',  alt: ['Little Dumbbell Nebula'],ra:  1.7053, dec:  51.5750, type: 'nebula',  magnitude: 10.1 },
  { id: 'M77',  name: 'M77',                                  ra:  2.7114, dec:  -0.0133, type: 'galaxy',  magnitude: 8.9 },
  { id: 'M78',  name: 'M78',                                  ra:  5.7794, dec:   0.0792, type: 'nebula',  magnitude: 8.3 },
  { id: 'M79',  name: 'M79',                                  ra:  5.4042, dec: -24.5244, type: 'cluster', magnitude: 8.4 },
  { id: 'M80',  name: 'M80',                                  ra: 16.2839, dec: -22.9764, type: 'cluster', magnitude: 7.3 },
  { id: 'M81',  name: 'M81',  alt: ["Bode's Galaxy"],         ra:  9.9256, dec:  69.0653, type: 'galaxy',  magnitude: 6.9 },
  { id: 'M82',  name: 'M82',  alt: ['Cigar Galaxy'],          ra:  9.9311, dec:  69.6797, type: 'galaxy',  magnitude: 8.4 },
  { id: 'M83',  name: 'M83',  alt: ['Southern Pinwheel'],     ra: 13.6167, dec: -29.8656, type: 'galaxy',  magnitude: 7.5 },
  { id: 'M84',  name: 'M84',                                  ra: 12.4178, dec:  12.8867, type: 'galaxy',  magnitude: 9.1 },
  { id: 'M85',  name: 'M85',                                  ra: 12.4231, dec:  18.1911, type: 'galaxy',  magnitude: 9.1 },
  { id: 'M86',  name: 'M86',                                  ra: 12.4364, dec:  12.9461, type: 'galaxy',  magnitude: 8.9 },
  { id: 'M87',  name: 'M87',  alt: ['Virgo A'],               ra: 12.5136, dec:  12.3914, type: 'galaxy',  magnitude: 8.6 },
  { id: 'M88',  name: 'M88',                                  ra: 12.5331, dec:  14.4203, type: 'galaxy',  magnitude: 9.6 },
  { id: 'M89',  name: 'M89',                                  ra: 12.5944, dec:  12.5564, type: 'galaxy',  magnitude: 9.8 },
  { id: 'M90',  name: 'M90',                                  ra: 12.6139, dec:  13.1628, type: 'galaxy',  magnitude: 9.5 },
  { id: 'M91',  name: 'M91',                                  ra: 12.5897, dec:  14.4964, type: 'galaxy',  magnitude: 10.2 },
  { id: 'M92',  name: 'M92',                                  ra: 17.2850, dec:  43.1361, type: 'cluster', magnitude: 6.4 },
  { id: 'M93',  name: 'M93',                                  ra:  7.7433, dec: -23.8667, type: 'cluster', magnitude: 6.2 },
  { id: 'M94',  name: 'M94',                                  ra: 12.8483, dec:  41.1203, type: 'galaxy',  magnitude: 8.2 },
  { id: 'M95',  name: 'M95',                                  ra: 10.7331, dec:  11.7039, type: 'galaxy',  magnitude: 9.7 },
  { id: 'M96',  name: 'M96',                                  ra: 10.7794, dec:  11.8197, type: 'galaxy',  magnitude: 9.2 },
  { id: 'M97',  name: 'M97',  alt: ['Owl Nebula'],            ra: 11.2461, dec:  55.0192, type: 'nebula',  magnitude: 9.9 },
  { id: 'M98',  name: 'M98',                                  ra: 12.2306, dec:  14.9008, type: 'galaxy',  magnitude: 10.1 },
  { id: 'M99',  name: 'M99',                                  ra: 12.3128, dec:  14.4164, type: 'galaxy',  magnitude: 9.9 },
  { id: 'M100', name: 'M100',                                 ra: 12.3819, dec:  15.8225, type: 'galaxy',  magnitude: 9.3 },
  { id: 'M101', name: 'M101', alt: ['Pinwheel Galaxy'],       ra: 14.0533, dec:  54.3489, type: 'galaxy',  magnitude: 7.9 },
  { id: 'M102', name: 'M102', alt: ['Spindle Galaxy'],        ra: 15.1083, dec:  55.7633, type: 'galaxy',  magnitude: 9.9 },
  { id: 'M103', name: 'M103',                                 ra:  1.5556, dec:  60.6583, type: 'cluster', magnitude: 7.4 },
  { id: 'M104', name: 'M104', alt: ['Sombrero Galaxy'],       ra: 12.6664, dec: -11.6231, type: 'galaxy',  magnitude: 8.0 },
  { id: 'M105', name: 'M105',                                 ra: 10.7972, dec:  12.5817, type: 'galaxy',  magnitude: 9.3 },
  { id: 'M106', name: 'M106',                                 ra: 12.3158, dec:  47.3036, type: 'galaxy',  magnitude: 8.4 },
  { id: 'M107', name: 'M107',                                 ra: 16.5422, dec: -13.0539, type: 'cluster', magnitude: 7.9 },
  { id: 'M108', name: 'M108', alt: ['Surfboard Galaxy'],      ra: 11.1917, dec:  55.6739, type: 'galaxy',  magnitude: 10.0 },
  { id: 'M109', name: 'M109',                                 ra: 11.9600, dec:  53.3744, type: 'galaxy',  magnitude: 9.8 },
  { id: 'M110', name: 'M110',                                 ra:  0.6733, dec:  41.6856, type: 'galaxy',  magnitude: 8.5 },

  // --- Famous NGC ---
  { id: 'NGC869',  name: 'NGC 869',  alt: ['Double Cluster', 'h Persei'],         ra:  2.3158, dec:  57.1333, type: 'double-cluster', magnitude: 5.3 },
  { id: 'NGC884',  name: 'NGC 884',  alt: ['Double Cluster', 'chi Persei'],       ra:  2.3717, dec:  57.1339, type: 'double-cluster', magnitude: 6.1 },
  { id: 'NGC7000', name: 'NGC 7000', alt: ['North America Nebula'],               ra: 20.9783, dec:  44.3333, type: 'nebula',  magnitude: 4.0 },
  { id: 'NGC3628', name: 'NGC 3628', alt: ['Hamburger Galaxy', 'Leo Triplet'],    ra: 11.3322, dec:  13.5897, type: 'galaxy',  magnitude: 10.2 },
  { id: 'NGC6960', name: 'NGC 6960', alt: ['Western Veil', 'Veil Nebula', "Witch's Broom"], ra: 20.7600, dec: 30.7167, type: 'nebula', magnitude: 7.0 },
  { id: 'NGC6992', name: 'NGC 6992', alt: ['Eastern Veil', 'Veil Nebula'],        ra: 20.9333, dec:  31.7167, type: 'nebula',  magnitude: 7.0 },
  { id: 'NGC2244', name: 'NGC 2244', alt: ['Rosette Cluster', 'Rosette Nebula'],  ra:  6.5350, dec:   4.9333, type: 'cluster', magnitude: 4.8 },
  { id: 'NGC7293', name: 'NGC 7293', alt: ['Helix Nebula'],                       ra: 22.4961, dec: -20.8372, type: 'nebula',  magnitude: 7.6 },
  { id: 'NGC891',  name: 'NGC 891',  alt: ['Silver Sliver Galaxy'],               ra:  2.3756, dec:  42.3492, type: 'galaxy',  magnitude: 10.0 },
  { id: 'NGC5128', name: 'NGC 5128', alt: ['Centaurus A'],                        ra: 13.4244, dec: -43.0192, type: 'galaxy',  magnitude: 6.8 },
  { id: 'NGC6826', name: 'NGC 6826', alt: ['Blinking Planetary'],                 ra: 19.7472, dec:  50.5181, type: 'nebula',  magnitude: 8.8 },
  { id: 'NGC7635', name: 'NGC 7635', alt: ['Bubble Nebula'],                      ra: 23.3433, dec:  61.2000, type: 'nebula',  magnitude: 10.0 },
  { id: 'NGC281',  name: 'NGC 281',  alt: ['Pacman Nebula'],                      ra:  0.8767, dec:  56.6228, type: 'nebula',  magnitude: 7.4 },
  { id: 'NGC1499', name: 'NGC 1499', alt: ['California Nebula'],                  ra:  4.0333, dec:  36.4167, type: 'nebula',  magnitude: 6.0 },
  { id: 'NGC6888', name: 'NGC 6888', alt: ['Crescent Nebula'],                    ra: 20.2000, dec:  38.3633, type: 'nebula',  magnitude: 7.4 },
  { id: 'NGC6781', name: 'NGC 6781',                                              ra: 19.3025, dec:   6.5375, type: 'nebula',  magnitude: 11.4 },
  { id: 'NGC6720', name: 'NGC 6720', alt: ['Ring Nebula', 'M57'],                 ra: 18.8917, dec:  33.0292, type: 'nebula',  magnitude: 8.8 },
  { id: 'NGC7331', name: 'NGC 7331', alt: ['Deer Lick Galaxy'],                   ra: 22.6178, dec:  34.4156, type: 'galaxy',  magnitude: 9.5 },
  { id: 'NGC6543', name: 'NGC 6543', alt: ["Cat's Eye Nebula"],                   ra: 17.9756, dec:  66.6328, type: 'nebula',  magnitude: 8.1 },
  { id: 'NGC3242', name: 'NGC 3242', alt: ['Ghost of Jupiter'],                   ra: 10.4128, dec: -18.6336, type: 'nebula',  magnitude: 7.7 },
  { id: 'NGC2392', name: 'NGC 2392', alt: ['Eskimo Nebula', 'Clownface Nebula'],  ra:  7.4736, dec:  20.9117, type: 'nebula',  magnitude: 9.2 },
  { id: 'NGC6818', name: 'NGC 6818', alt: ['Little Gem Nebula'],                  ra: 19.6722, dec: -14.1531, type: 'nebula',  magnitude: 9.3 },
  { id: 'NGC7009', name: 'NGC 7009', alt: ['Saturn Nebula'],                      ra: 21.0683, dec: -11.3633, type: 'nebula',  magnitude: 8.0 },
  { id: 'NGC4565', name: 'NGC 4565', alt: ['Needle Galaxy'],                      ra: 12.6064, dec:  25.9872, type: 'galaxy',  magnitude: 9.6 },
  { id: 'NGC4631', name: 'NGC 4631', alt: ['Whale Galaxy'],                       ra: 12.7028, dec:  32.5414, type: 'galaxy',  magnitude: 9.2 },
  { id: 'NGC2403', name: 'NGC 2403',                                              ra:  7.6111, dec:  65.6028, type: 'galaxy',  magnitude: 8.5 },
  { id: 'NGC7479', name: 'NGC 7479', alt: ['Superman Galaxy'],                    ra: 23.0833, dec:  12.3225, type: 'galaxy',  magnitude: 10.9 },
  { id: 'NGC246',  name: 'NGC 246',  alt: ['Skull Nebula'],                       ra:  0.7892, dec: -11.8722, type: 'nebula',  magnitude: 10.9 },
  { id: 'NGC1232', name: 'NGC 1232',                                              ra:  3.1611, dec: -20.5794, type: 'galaxy',  magnitude: 9.9 },
  { id: 'NGC2070', name: 'NGC 2070', alt: ['Tarantula Nebula', '30 Doradus'],     ra:  5.6428, dec: -69.1008, type: 'nebula',  magnitude: 8.0 },
  { id: 'NGC3372', name: 'NGC 3372', alt: ['Carina Nebula', 'Eta Carinae Nebula'],ra: 10.7517, dec: -59.8667, type: 'nebula',  magnitude: 1.0 },
  { id: 'NGC6334', name: 'NGC 6334', alt: ["Cat's Paw Nebula"],                   ra: 17.3550, dec: -35.7167, type: 'nebula',  magnitude: 10.0 },
];

/** Format RA as "HHh MMm". */
export function formatRa(ra: number): string {
  const h = Math.floor(ra);
  const m = Math.floor((ra - h) * 60);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
}

/** Format Dec as "+DD° MM'" (signed). */
export function formatDec(dec: number): string {
  const sign = dec < 0 ? '-' : '+';
  const abs = Math.abs(dec);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  return `${sign}${String(d).padStart(2, '0')}\u00B0 ${String(m).padStart(2, '0')}'`;
}

/** Case-insensitive match against name + alt names. */
export function matchesQuery(t: CatalogTarget, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (t.name.toLowerCase().includes(needle)) return true;
  // Also try matching with spaces stripped, so "M 31" / "NGC7000" search loosely.
  if (t.name.replace(/\s+/g, '').toLowerCase().includes(needle.replace(/\s+/g, ''))) return true;
  if (t.alt && t.alt.some((a) => a.toLowerCase().includes(needle))) return true;
  return false;
}
