import type { Fact } from '@/lib/sources/types';

/** The specification table. This is the substance the quality gate counts. */
export function FactTable({ facts }: { facts: Fact[] }) {
  if (facts.length === 0) return null;

  return (
    <div className="table-scroll">
      <table>
        <tbody>
          {facts.map((fact) => (
            <tr key={fact.label}>
              <th scope="row">{fact.label}</th>
              <td className="num">
                {fact.value}
                {fact.unit ? <span className="updated"> {fact.unit}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default FactTable;
