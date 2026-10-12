import {test,expect} from "vitest";import {detectSymbols} from "./market-symbols";
test("o",()=>{expect(detectSymbols("حلل الفضة والذهب").map(s=>s.key)).toEqual(["XAGUSD","XAUUSD"]);expect(detectSymbols("حلل EURUSD")[0]!.key).toBe("EURUSD");expect(detectSymbols("NAS100 now")[0]!.key).toBe("US100");});
