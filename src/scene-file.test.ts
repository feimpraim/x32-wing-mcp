import { test } from "node:test";
import assert from "node:assert/strict";
import { parseX32SceneFile, parseDb } from "./scene-file.js";

test("parseDb handles dB tokens and -oo", () => {
  assert.equal(parseDb("+2.0"), 2);
  assert.equal(parseDb("-14.5"), -14.5);
  assert.equal(parseDb("0.0"), 0);
  assert.equal(parseDb("-oo"), -90);
  assert.equal(parseDb(undefined), -90);
  assert.equal(parseDb("garbage"), -90);
});

const SAMPLE = `#4.0# "TestScene" "" %000000000 1
/ch/01/config "Lead Mic" 51 CY 1
/ch/01/preamp +0.5 OFF ON 24 128
/ch/01/gate ON GATE -53.0 60.0 0 502 141 0
/ch/01/dyn ON COMP PEAK LOG -24.0 3.0 1 5.00 6 0.32 59 POST 0 100 ON
/ch/01/eq ON
/ch/01/mix ON  +2.0 OFF +0 OFF   -oo
/ch/02/config "KickIn" 3 GN 18
/ch/02/preamp -4.0 OFF OFF 12 80
/ch/02/gate OFF GATE -80.0 60.0 0 502 141 0
/ch/02/dyn OFF COMP PEAK LOG -24.0 3.0 1 5.00 6 0.32 59 POST 0 100 ON
/ch/02/eq ON
/ch/02/mix ON  -4.0 OFF +0 OFF   -oo
/bus/01/config "Drum IEM" 71 GNi
/bus/01/mix ON   0.0 OFF +0 OFF   -oo
/dca/1 ON   0.0
/dca/1/config "VoxMics" 70 CY
/main/st/config "" 66 WH
/main/st/mix ON   -oo +0
`;

test("parses channels with names, fader dB, and on/off states", () => {
  const s = parseX32SceneFile(SAMPLE);
  assert.equal(s.console, 'X32 scene file "TestScene"');
  assert.equal(s.channels.length, 2);

  const c1 = s.channels[0];
  assert.equal(c1.name, "Lead Mic");
  assert.equal(c1.faderDb, 2);
  assert.equal(c1.muted, false);
  assert.equal(c1.hpfOn, true);
  assert.equal(c1.hpfRaw, 128);
  assert.equal(c1.gateOn, true);
  assert.equal(c1.compOn, true);
  assert.equal(c1.eqOn, true);

  const c2 = s.channels[1];
  assert.equal(c2.name, "KickIn");
  assert.equal(c2.hpfOn, false);
  assert.equal(c2.gateOn, false);
  assert.equal(c2.compOn, false);
});

test("parses buses, DCAs, and main", () => {
  const s = parseX32SceneFile(SAMPLE);
  assert.equal(s.buses[0].name, "Drum IEM");
  assert.equal(s.dcas[0].name, "VoxMics");
  assert.equal(s.main.faderDb, -90);
  assert.equal(s.main.muted, false);
});

test("channel names with quotes are unwrapped, missing fields are undefined", () => {
  const s = parseX32SceneFile(`#4.0# "S" "" %0 1\n/ch/03/config "BGV 1" 51 CY 3\n/ch/03/mix ON -2.0 OFF +0 OFF -oo\n`);
  assert.equal(s.channels.length, 1);
  assert.equal(s.channels[0].name, "BGV 1");
  assert.equal(s.channels[0].hpfOn, undefined);
  assert.equal(s.channels[0].gateOn, undefined);
});
