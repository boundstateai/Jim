import { ChemEngineApp } from "./ChemEngineApp";
import { jimMathPack } from "./packs/jimMath";
import { StudyRewards } from "./StudyRewards";
import { ActivityTracker } from "./ActivityTracker";
import { LoginGate } from "./Login";

// Jim uses the shared study engine with his own math curriculum.
export default function App({ pack = jimMathPack }) {
  return (
    <LoginGate>
    <ActivityTracker course={pack.id} />
    <StudyRewards />
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

