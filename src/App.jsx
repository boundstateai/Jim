import { ChemEngineApp } from "./ChemEngineApp";
import { uahCalculusPack } from "./packs/uahCalculus";
import { ActivityTracker } from "./ActivityTracker";
import { LoginGate } from "./Login";

// MA 171 uses the shared study engine with an isolated calculus curriculum.
export default function App({ pack = uahCalculusPack }) {
  return (
    <LoginGate>
    <ActivityTracker course={pack.id} />
    <ChemEngineApp
      chapters={pack.chapters}
      formulas={pack.formulas}
      totalFormulas={pack.formulas.length}
      debtStart={pack.debtStart ?? pack.formulas.length * pack.perFormula}
      perFormula={pack.perFormula}
      brand={pack.brand}
      exams={pack.exams}
      groups={pack.groups}
      tutor={pack.tutor}
      chatSeeds={pack.chatSeeds}
      storageKey={pack.storageKey}
      legacyKey={pack.legacyKey}
      course={pack.id}
      rewardsEnabled={pack.rewardsEnabled ?? true}
    />
    </LoginGate>
  );
}
