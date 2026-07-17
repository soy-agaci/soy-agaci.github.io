import * as d3 from 'd3';
import { D3Node } from '../../types/types';
import { is_member, get_death_date, get_image_path, get_gender } from './dagWithFamilyData';
import { LAYOUT_CONSTANTS } from '../../constants/layout';

export function get_node_size() {
    return LAYOUT_CONSTANTS.NODE_SIZE;
}

export function get_css_class(node: D3Node) {
    if (!is_member(node)) return "family";
    let cssClass = "member";
    if (!node.added_data.is_highlighted) {
        cssClass += " non-highlighted";
    } else {
        cssClass += " highlighted";
    }
    if (node.added_data.is_ugly) {
        cssClass += " ugly";
    }
    if (get_death_date(node)) {
        cssClass += " deceased";

        // Check if node has children
        const children = node.children ? node.children() : [];
        const hasChildren = children.length > 0;

        // Check if any children are visible (node is uncollapsed)
        const hasVisibleChildren = hasChildren && children.some(child => child.added_data.is_visible);

        // If node has no children OR is uncollapsed, use less prominent styling
        if (!hasChildren || hasVisibleChildren) {
            cssClass += " deceased-uncollapsed";
        }
    }
    return cssClass;
}

export function add_images(group: d3.Selection<SVGGElement, D3Node, SVGGElement, unknown>) {
    function get_clip_path_id(node: D3Node) {
        return "clip_to_circle_" + node.data;
    };
    group.append("defs")
        .append("clipPath")
        .attr("id", node => get_clip_path_id(node))
        .append("circle")
        .attr("r", get_node_size() - 1.0);
    let image_size = 2.0 * get_node_size();
    
    // Only add image if path exists
    group.filter(node => get_image_path(node) !== "")
        .append("image")
        .attr("x", -image_size / 2.0)
        .attr("y", -image_size / 2.0)
        .attr("width", image_size)
        .attr("height", image_size)
        .attr("href", node => get_image_path(node))
        .attr("referrerpolicy", "no-referrer")
        .attr("clip-path", node => "url(#" + get_clip_path_id(node) + ")")
        .attr("cursor", "pointer");

    // Add crescent symbol if deceased and NO image
    group.filter(node => get_image_path(node) === "" && get_death_date(node) !== "")
        .append("text")
        .attr("class", "deceased-symbol")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", get_node_size() * 1.0)
        .attr("dy", "0em") // vertical adjustment to center
        .attr("fill", "#FFFFFF") // This might not affect all emojis, but keeping it
        .style("filter", "grayscale(70%)") // Force black and white with 70% intensity
        .style("pointer-events", "none")
        .text("🕊️"); // Changed from 🪦 to 🕊️

    // Add gender symbol if not deceased, NO image, and is a member
    group.filter(node => get_image_path(node) === "" && get_death_date(node) === "" && is_member(node))
        .append("text")
        .attr("class", "gender-symbol")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", get_node_size() * 1.0)
        .attr("dy", "0em")
        .attr("fill", "#FFFFFF") // White for consistency
        .style("filter", "grayscale(70%)") // Apply grayscale filter with 70% intensity
        .style("pointer-events", "none")
        .text(node => {
            const gender = get_gender(node);
            if (gender === 'E') return '👔'; // Male is Necktie
            if (gender === 'K') return '🎀'; // Female is Ribbon Bow
            return '👤'; // Default for unknown/other gender
        });
}

export function refresh_images(group: d3.Selection<SVGGElement, D3Node, any, unknown>) {
    group.selectAll('defs, image, text.deceased-symbol, text.gender-symbol').remove();
    add_images(group as d3.Selection<SVGGElement, D3Node, SVGGElement, unknown>);
}
