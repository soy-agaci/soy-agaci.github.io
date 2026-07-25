import * as d3 from 'd3';
import { D3Node } from '../../types/types';
import { is_member, get_name, get_second_names, get_birth_date, get_death_date, get_occupation, get_note, get_birth_place, get_death_place, get_marriage } from './dagWithFamilyData';
import { get_node_size } from './NodeHelpers';
import { LAYOUT_CONSTANTS } from '../../constants/layout';

export function set_multiline(d3_element: d3.Selection<SVGGElement, D3Node, any, any>, node: D3Node, edit_mode = true) {
    function get_array(name_string: string) {
        let names = name_string.match(/[^\s]+/gi);
        if (!names) return [];
        return names;
    }
    function is_special(text: string) {
        for (let word of ["Heilige", "Freiherr", "Graf", "der", "von", "zu", "bei", "Dr.", "med.", "Dr", "med", "St.", "St"]) {
            if (text == word) return true;
        }
        for (let symbol of [".", "/", "-", "(", ")"]) {
            if (text.includes(symbol)) return true;
        }
        return false;
    }

    function get_all_names_text(node: D3Node) {
        let names = get_array(get_name(node));
        let second_names = get_array(get_second_names(node));
        let second_name_unique = second_names.length < 2;
        let all_names = names[0];
        for (let i = 0; i < second_names.length; i++) {
            if (second_names[i] == "") continue;
            if (second_name_unique || (is_special(second_names[i])))
                all_names += " " + second_names[i];
            else
                all_names += " " + second_names[i][0] + ".";
        }
        for (let i = 1; i < names.length; i++) {
            all_names += " " + names[i];
        }
        if (get_death_date(node)) {
            // all_names += " ☽";
        }
        return all_names;
    }

    function get_birth_and_death_text(node: D3Node) {
        let birth_date = get_birth_date(node);
        let death_date = get_death_date(node);
        return birth_date + (death_date != "" ? " - " + death_date : "");
    }

    function get_occupation_text(node: D3Node) {
        return get_occupation(node);
    }

    function get_note_text(node: D3Node) {
        return get_note(node);
    }

    function get_places_and_marriage_text(node: D3Node) {
        let birth_place = get_birth_place(node);
        let death_place = get_death_place(node);
        let marriage = get_marriage(node);
        let birth_and_death_place = "";
        if (birth_place == death_place) {
            birth_and_death_place = birth_place;
            birth_place = "";
            death_place = "";
        }
        let text = "";
        if (birth_and_death_place != "")
            text += (text != "" ? " " : "") + "◦● " + birth_and_death_place;
        if (birth_place != "") text += (text != "" ? " " : "") + "◦ " + birth_place;
        if (death_place != "") text += (text != "" ? " " : "") + "● " + death_place;
        if (marriage != "") text += (text != "" ? " " : "") + "⚭ " + marriage;
        return text;
    }

    function get_label(node: D3Node, edit_mode: boolean) {
        if (!is_member(node)) return [];
        let all_names = get_all_names_text(node);
        let birth_and_death = get_birth_and_death_text(node);
        let occupation = get_occupation_text(node);
        let places_and_marriage = get_places_and_marriage_text(node);
        let note = get_note_text(node);
        let lines = [all_names];
        if (birth_and_death != "") lines.push(birth_and_death);
        if ((occupation != "") && edit_mode) lines.push(occupation);
        if ((places_and_marriage != "") && edit_mode) lines.push(places_and_marriage);
        if ((note != "") && edit_mode) lines.push(note);
        return lines;
    }

    d3_element.selectAll("text.node-label").remove();
    let lines = get_label(node, edit_mode);
    if (lines.length < 1) return;
    let d3_text = d3_element.append("text").attr("class", "node-label").attr("dominant-baseline", "central");
    let line_sep = LAYOUT_CONSTANTS.LABEL_LINE_SEPARATION;
    let line_offset = -line_sep * (lines.length - 1) / 2;
    for (let i = 0; i < lines.length; i++) {
        let line_text = lines[i];
        let line_length = LAYOUT_CONSTANTS.MAX_LABEL_LENGTH;
        if (line_text.length > line_length) {
            line_text = line_text.substring(0, line_length - 3) + "...";
        }
        let d3_tspan = d3_text.append("tspan")
            .text(line_text)
            .attr("dy", i == 0 ? line_offset : line_sep)
            .attr("x", get_node_size() + 8);
        if (i >= 2) d3_tspan.attr("fill-opacity", 0.5).attr("font-size", "75%");
    }
}
